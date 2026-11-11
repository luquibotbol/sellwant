-- Fair-use limits on the two agent features that spend shared resources.
--
-- 1. start_agent_watch: at most three live watches per owner (see the comment
--    inside). The body is 202611050006's verbatim plus that rule; CREATE OR
--    REPLACE keeps its authenticated-only grant.
--
-- 2. consume_agent_draft_quota(): /api/agent/draft makes one operator-paid
--    model call per request, and nothing counted them, so one account could
--    run up the bill. The Worker now spends one unit of a per-user daily
--    budget before generating, with the user's own JWT.
--
-- Both features are off by default and refuse production.

BEGIN;

CREATE OR REPLACE FUNCTION public.start_agent_watch(p_mandate_id uuid,p_capability_id uuid,p_enrollment_key uuid,p_expires_at timestamptz,p_ciphertext text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE u uuid:=public._agent_human(); m public.agent_mandates%rowtype; c public.agent_capabilities%rowtype; w public.agent_watches%rowtype;
BEGIN
  SELECT * INTO m FROM public.agent_mandates WHERE id=p_mandate_id AND owner_id=u;
  IF NOT FOUND THEN RAISE EXCEPTION 'watch unavailable'; END IF;
  -- Match action/access order: capability -> mandate -> profile. A mandate
  -- lock acquired before a capability UPDATE would deadlock a running action.
  SELECT * INTO c FROM public.agent_capabilities WHERE id=p_capability_id AND mandate_id=m.id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'watch unavailable'; END IF;
  SELECT * INTO m FROM public.agent_mandates WHERE id=p_mandate_id AND owner_id=u FOR UPDATE;
  PERFORM id FROM public.profiles WHERE id=u FOR SHARE;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=u AND NOT is_suspended) THEN RAISE EXCEPTION 'human unavailable'; END IF;
  SELECT * INTO w FROM public.agent_watches WHERE enrollment_key=p_enrollment_key;
  IF FOUND THEN
    IF w.owner_id<>u OR w.mandate_id<>m.id OR w.capability_id<>p_capability_id OR w.expires_at IS DISTINCT FROM p_expires_at THEN
      RAISE EXCEPTION 'enrollment key reused';
    END IF;
    RETURN jsonb_build_object('id',w.id,'mandate_id',w.mandate_id,'state',w.state,'expires_at',w.expires_at);
  END IF;
  IF m.status<>'approved' OR m.revoked_at IS NOT NULL OR m.expires_at<=clock_timestamp()
    OR c.revoked_at IS NOT NULL OR c.expires_at<=clock_timestamp()
    OR NOT ARRAY['get_mandate','get_deal','place_offer','accept_offer']::text[] <@ c.tools
    -- Exact capability/watch expiry is enforced by agent_mandate_action inside
    -- its transaction, so a staged/stale sender cannot outlive enrollment.
    OR p_expires_at IS NULL OR p_expires_at<=clock_timestamp() OR p_expires_at IS DISTINCT FROM c.expires_at OR p_expires_at>m.expires_at
    OR p_enrollment_key IS NULL THEN RAISE EXCEPTION 'watch requires approved unexpired scoped authority'; END IF;
  -- One owner may hold at most three live watches. The watcher claims four
  -- jobs a minute across everybody, so without a cap one account could enroll
  -- dozens and push every other user's watch to a run every few minutes.
  -- Serialized per owner so two enrollments cannot both pass the count.
  PERFORM pg_advisory_xact_lock(hashtextextended('agent_watch_owner:'||u::text,0));
  IF (SELECT count(*) FROM public.agent_watches WHERE owner_id=u AND state IN ('active','blocked')
      AND expires_at>clock_timestamp()) >= 3 THEN
    RAISE EXCEPTION 'too many active watches';
  END IF;
  INSERT INTO public.agent_watches(mandate_id,owner_id,capability_id,enrollment_key,expires_at)
    VALUES(m.id,u,c.id,p_enrollment_key,p_expires_at) RETURNING * INTO w;
  INSERT INTO public.agent_watch_secrets(watch_id,ciphertext) VALUES(w.id,p_ciphertext);
  RETURN jsonb_build_object('id',w.id,'mandate_id',w.mandate_id,'state',w.state,'expires_at',w.expires_at);
END;
$$;

CREATE TABLE IF NOT EXISTS public.agent_draft_usage (
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day date NOT NULL,
  drafts integer NOT NULL DEFAULT 0 CHECK (drafts >= 0),
  PRIMARY KEY (owner_id, day)
);
ALTER TABLE public.agent_draft_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_draft_usage FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_agent_draft_quota()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE u uuid := auth.uid(); n integer;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'account required' USING ERRCODE='42501'; END IF;
  INSERT INTO public.agent_draft_usage(owner_id, day, drafts)
    VALUES (u, (now() AT TIME ZONE 'utc')::date, 1)
    ON CONFLICT (owner_id, day) DO UPDATE SET drafts = agent_draft_usage.drafts + 1
    RETURNING drafts INTO n;
  RETURN n <= 20;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_agent_draft_quota() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_agent_draft_quota() TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
