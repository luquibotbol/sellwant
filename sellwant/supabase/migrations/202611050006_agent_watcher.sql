-- Durable scheduled trading uses existing immutable mandate/capability RPCs.
-- Human enrollment is separate from mandate approval. Service role can queue
-- work but cannot approve mandates or advance money/handoff via these RPCs.
BEGIN;
SET LOCAL ROLE postgres;

CREATE TABLE public.agent_watches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id uuid NOT NULL UNIQUE REFERENCES public.agent_mandates(id),
  owner_id uuid NOT NULL REFERENCES public.profiles(id),
  capability_id uuid NOT NULL REFERENCES public.agent_capabilities(id),
  enrollment_key uuid NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','stopped','finished','blocked')),
  next_run_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  last_context_hash text,
  scan_cursor text CHECK (scan_cursor IS NULL OR scan_cursor ~ '^[A-Za-z0-9_-]{1,1024}$'),
  offer_cursor text CHECK (offer_cursor IS NULL OR offer_cursor ~ '^[A-Za-z0-9_-]{1,1024}$'),
  last_diagnostic jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL)),
  CHECK (last_context_hash IS NULL OR last_context_hash ~ '^[0-9a-f]{64}$'),
  CHECK (last_error IS NULL OR last_error IN ('unavailable','unknown','invalid_proposal','denied','model_refused','invalid_configuration','account_required'))
);
CREATE INDEX agent_watches_due ON public.agent_watches(next_run_at) WHERE state='active';
CREATE TABLE public.agent_watch_secrets (
  watch_id uuid PRIMARY KEY REFERENCES public.agent_watches(id) ON DELETE CASCADE,
  ciphertext text NOT NULL CHECK (length(ciphertext) BETWEEN 80 AND 2048 AND ciphertext ~ '^v1\.[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+$')
);
CREATE TABLE public.agent_watch_operations (
  operation_key uuid PRIMARY KEY,
  watch_id uuid NOT NULL REFERENCES public.agent_watches(id) ON DELETE CASCADE,
  context_hash text NOT NULL CHECK (context_hash ~ '^[0-9a-f]{64}$'),
  proposal jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','unknown','succeeded','rejected')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (watch_id,context_hash),
  CHECK (jsonb_typeof(proposal)='object' AND proposal->>'action' IN ('place_offer','accept_offer')),
  CHECK (NOT proposal::text ~ 'swcap_[0-9a-f]{64}')
);
CREATE UNIQUE INDEX agent_watch_one_pending ON public.agent_watch_operations(watch_id) WHERE status IN ('pending','unknown');
ALTER TABLE public.agent_watches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_watch_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_watch_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_watches,public.agent_watch_secrets,public.agent_watch_operations FROM PUBLIC,anon,authenticated,service_role;
-- No API role can SELECT ciphertext or lease secrets, even with SELECT *.
GRANT SELECT (id,mandate_id,owner_id,capability_id,enrollment_key,expires_at,state,next_run_at,last_error,created_at,updated_at)
  ON public.agent_watches TO authenticated;
GRANT SELECT ON public.agent_watch_operations TO authenticated;
CREATE POLICY agent_watch_owner_read ON public.agent_watches FOR SELECT TO authenticated USING (owner_id=auth.uid());
CREATE POLICY agent_watch_operation_owner_read ON public.agent_watch_operations FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.agent_watches w WHERE w.id=watch_id AND w.owner_id=auth.uid()));

CREATE FUNCTION public.start_agent_watch(p_mandate_id uuid,p_capability_id uuid,p_enrollment_key uuid,p_expires_at timestamptz,p_ciphertext text)
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
  INSERT INTO public.agent_watches(mandate_id,owner_id,capability_id,enrollment_key,expires_at)
    VALUES(m.id,u,c.id,p_enrollment_key,p_expires_at) RETURNING * INTO w;
  INSERT INTO public.agent_watch_secrets(watch_id,ciphertext) VALUES(w.id,p_ciphertext);
  RETURN jsonb_build_object('id',w.id,'mandate_id',w.mandate_id,'state',w.state,'expires_at',w.expires_at);
END;
$$;
CREATE FUNCTION public.stop_agent_watch(p_watch_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.agent_watches%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'human required'; END IF;
  SELECT * INTO w FROM public.agent_watches WHERE id=p_watch_id AND owner_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'watch unavailable'; END IF;
  -- Share capability -> mandate lock ordering with agent action. Revocation prevents a stale
  -- worker trading after Stop commits, including requests already waiting.
  PERFORM id FROM public.agent_capabilities WHERE id=w.capability_id FOR UPDATE;
  PERFORM id FROM public.agent_mandates WHERE id=w.mandate_id FOR UPDATE;
  SELECT * INTO w FROM public.agent_watches WHERE id=p_watch_id FOR UPDATE;
  UPDATE public.agent_capabilities SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=w.capability_id;
  UPDATE public.agent_watch_operations SET status='unknown',updated_at=clock_timestamp() WHERE watch_id=w.id AND status='pending';
  UPDATE public.agent_watches SET state='stopped',lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=w.id;
  RETURN jsonb_build_object('id',w.id,'state','stopped');
END;
$$;
CREATE FUNCTION public.claim_agent_watches(p_limit integer DEFAULT 4) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.agent_watches%rowtype; output jsonb:='[]'::jsonb; token uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 8 THEN RAISE EXCEPTION 'watch service required'; END IF;
  FOR w IN SELECT * FROM public.agent_watches WHERE state='active' AND next_run_at<=clock_timestamp()
    AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit LOOP
    IF w.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.agent_mandates m
      JOIN public.agent_capabilities c ON c.id=w.capability_id JOIN public.profiles p ON p.id=m.owner_id
      WHERE m.id=w.mandate_id AND m.status IN ('approved','consumed') AND m.revoked_at IS NULL
        AND m.expires_at>clock_timestamp() AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND NOT p.is_suspended) THEN
      UPDATE public.agent_watch_operations SET status='unknown',updated_at=clock_timestamp()
        WHERE watch_id=w.id AND status='pending';
      UPDATE public.agent_watches SET state=CASE WHEN EXISTS(SELECT 1 FROM public.agent_watch_operations
          WHERE watch_id=w.id AND status='unknown') THEN 'blocked' ELSE 'stopped' END,
        last_error=CASE WHEN EXISTS(SELECT 1 FROM public.agent_watch_operations WHERE watch_id=w.id AND status='unknown') THEN 'denied' ELSE last_error END,
        lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=w.id;
      CONTINUE;
    END IF;
    token:=gen_random_uuid();
    UPDATE public.agent_watches SET lease_token=token,lease_until=clock_timestamp()+interval '150 seconds',updated_at=clock_timestamp() WHERE id=w.id;
    output:=output||jsonb_build_array(jsonb_build_object('id',w.id,'mandate_id',w.mandate_id,'capability_id',w.capability_id,
      'expires_at',w.expires_at,'lease_token',token,'last_context_hash',w.last_context_hash,'scan_cursor',w.scan_cursor,'offer_cursor',w.offer_cursor,
      'ciphertext',(SELECT ciphertext FROM public.agent_watch_secrets WHERE watch_id=w.id),
      'pending',(SELECT jsonb_build_object('operation_key',o.operation_key,'proposal',o.proposal,'context_hash',o.context_hash)
        FROM public.agent_watch_operations o WHERE o.watch_id=w.id AND o.status IN ('pending','unknown')),
      'own_offer_ids',(SELECT coalesce(jsonb_agg(result->>'offer_id'),'[]'::jsonb) FROM public.agent_watch_operations o
        WHERE o.watch_id=w.id AND o.status='succeeded' AND o.result ? 'offer_id')));
  END LOOP;
  RETURN output;
END;
$$;
CREATE FUNCTION public.stage_agent_watch_operation(p_watch_id uuid,p_lease_token uuid,p_operation_key uuid,p_context_hash text,p_proposal jsonb,p_next_offer_cursor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.agent_watches%rowtype; o public.agent_watch_operations%rowtype;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'watch service required'; END IF;
  SELECT * INTO w FROM public.agent_watches WHERE id=p_watch_id FOR UPDATE;
  IF NOT FOUND OR w.state<>'active' OR w.lease_token IS DISTINCT FROM p_lease_token OR w.lease_until<=clock_timestamp()
    OR w.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'stale watch lease'; END IF;
  IF p_proposal IS NULL OR jsonb_typeof(p_proposal)<>'object' OR octet_length(p_proposal::text)>8192
    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_proposal) k) IS DISTINCT FROM
      ARRAY['action','amount_cents','explanation','message','model','offer_id','parent_offer_id','response_id']::text[]
    OR p_proposal->>'action' IS NULL OR p_proposal->>'action' NOT IN ('place_offer','accept_offer') OR p_proposal::text ~ 'swcap_[0-9a-f]{64}' THEN
    RAISE EXCEPTION 'invalid watch proposal';
  END IF;
  SELECT * INTO o FROM public.agent_watch_operations WHERE watch_id=w.id AND status IN ('pending','unknown');
  IF FOUND THEN
    IF o.operation_key<>p_operation_key OR o.context_hash<>p_context_hash OR o.proposal IS DISTINCT FROM p_proposal THEN
      RAISE EXCEPTION 'pending proposal cannot change';
    END IF;
  ELSE
    INSERT INTO public.agent_watch_operations(operation_key,watch_id,context_hash,proposal)
      VALUES(p_operation_key,w.id,p_context_hash,p_proposal) RETURNING * INTO o;
  END IF;
  UPDATE public.agent_watches SET offer_cursor=p_next_offer_cursor WHERE id=w.id;
  RETURN jsonb_build_object('operation_key',o.operation_key,'proposal',o.proposal,'context_hash',o.context_hash);
END;
$$;
CREATE FUNCTION public.finish_agent_watch(p_watch_id uuid,p_lease_token uuid,p_state text,p_context_hash text DEFAULT NULL,p_scan_cursor text DEFAULT NULL,
  p_operation_key uuid DEFAULT NULL,p_result jsonb DEFAULT NULL,p_error text DEFAULT NULL,p_offer_cursor text DEFAULT NULL,
  p_advance_offer_cursor boolean DEFAULT false,p_diagnostic jsonb DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.agent_watches%rowtype;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR p_state IS NULL OR p_state NOT IN ('active','finished','blocked') OR
    (p_error IS NOT NULL AND p_error NOT IN ('unavailable','unknown','invalid_proposal','denied','model_refused','invalid_configuration','account_required')) THEN
    RAISE EXCEPTION 'invalid watch completion';
  END IF;
  SELECT * INTO w FROM public.agent_watches WHERE id=p_watch_id FOR UPDATE;
  IF NOT FOUND OR w.state<>'active' OR w.lease_token IS DISTINCT FROM p_lease_token OR w.lease_until<=clock_timestamp() THEN RETURN false; END IF;
  IF p_diagnostic IS NOT NULL AND (jsonb_typeof(p_diagnostic)<>'object' OR octet_length(p_diagnostic::text)>1000
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_diagnostic) k WHERE k NOT IN ('stage','http_status','request_id','error_code','error_type'))
    OR p_diagnostic::text ~ 'swcap_|sk-|sb_secret_') THEN RAISE EXCEPTION 'invalid diagnostic'; END IF;
  IF p_operation_key IS NOT NULL THEN
    IF p_result IS NOT NULL AND (jsonb_typeof(p_result)<>'object' OR p_result->>'status' IS NULL OR
      p_result->>'status' NOT IN ('succeeded','rejected') OR octet_length(p_result::text)>8192) THEN
      RAISE EXCEPTION 'invalid watch receipt';
    END IF;
    UPDATE public.agent_watch_operations SET status=coalesce(p_result->>'status','unknown'),result=p_result,updated_at=clock_timestamp()
      WHERE watch_id=w.id AND operation_key=p_operation_key AND status IN ('pending','unknown');
    IF NOT FOUND THEN RAISE EXCEPTION 'unknown watch operation'; END IF;
  END IF;
  UPDATE public.agent_watches SET state=p_state,last_context_hash=coalesce(p_context_hash,last_context_hash),scan_cursor=p_scan_cursor,last_error=p_error,
    offer_cursor=CASE WHEN p_advance_offer_cursor THEN p_offer_cursor ELSE offer_cursor END,last_diagnostic=p_diagnostic,
    next_run_at=clock_timestamp()+CASE WHEN p_error IS NULL THEN interval '1 minute' ELSE interval '5 minutes' END,
    lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=w.id;
  RETURN true;
END;
$$;
CREATE FUNCTION public.resume_agent_watch(p_watch_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE u uuid:=public._agent_human(); w public.agent_watches%rowtype;
BEGIN
  SELECT * INTO w FROM public.agent_watches WHERE id=p_watch_id AND owner_id=u;
  IF NOT FOUND THEN RAISE EXCEPTION 'watch unavailable'; END IF;
  PERFORM id FROM public.agent_capabilities WHERE id=w.capability_id FOR SHARE;
  PERFORM id FROM public.agent_mandates WHERE id=w.mandate_id FOR UPDATE;
  SELECT * INTO w FROM public.agent_watches WHERE id=p_watch_id FOR UPDATE;
  PERFORM id FROM public.profiles WHERE id=u FOR SHARE;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=u AND NOT is_suspended) THEN RAISE EXCEPTION 'human unavailable'; END IF;
  IF w.state<>'blocked' OR w.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.agent_mandates m
    JOIN public.agent_capabilities c ON c.id=w.capability_id WHERE m.id=w.mandate_id AND m.status='approved'
    AND m.revoked_at IS NULL AND c.revoked_at IS NULL AND m.expires_at>=w.expires_at AND c.expires_at=w.expires_at) THEN
    RAISE EXCEPTION 'watch cannot resume';
  END IF;
  UPDATE public.agent_watches SET state='active',last_error=NULL,last_diagnostic=NULL,next_run_at=clock_timestamp(),
    lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=w.id;
  RETURN jsonb_build_object('id',w.id,'state','active','mandate_id',w.mandate_id,'expires_at',w.expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.start_agent_watch(uuid,uuid,uuid,timestamptz,text),public.stop_agent_watch(uuid),
  public.resume_agent_watch(uuid),public.claim_agent_watches(integer),public.stage_agent_watch_operation(uuid,uuid,uuid,text,jsonb,text),
  public.finish_agent_watch(uuid,uuid,text,text,text,uuid,jsonb,text,text,boolean,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.start_agent_watch(uuid,uuid,uuid,timestamptz,text),public.stop_agent_watch(uuid),public.resume_agent_watch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_agent_watches(integer),public.stage_agent_watch_operation(uuid,uuid,uuid,text,jsonb,text),
  public.finish_agent_watch(uuid,uuid,text,text,text,uuid,jsonb,text,text,boolean,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
