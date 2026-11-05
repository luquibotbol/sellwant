-- Apply after 202611050002. Preserve public active negotiation while keeping
-- completed prices and private account contacts out of unrelated reads.
BEGIN;
SET LOCAL ROLE postgres;

DROP POLICY offers_select ON public.offers;
CREATE POLICY offers_select ON public.offers FOR SELECT TO authenticated USING (
  from_user = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.listings l WHERE l.id = offers.listing_id
      AND (l.status = 'active' OR l.user_id = auth.uid())
  )
  OR EXISTS (
    SELECT 1 FROM public.lock_ins d WHERE d.listing_id = offers.listing_id
      AND d.state <> 'cancelled' AND auth.uid() IN (d.buyer_id, d.seller_id)
  )
);

-- Fixture maintenance is a trusted server operation, never a product RPC for
-- ordinary users. Keep the target-fixture guard and avoid contact-bearing errors.
CREATE OR REPLACE FUNCTION public.purge_test_listing(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE owner_email text;
BEGIN
  SELECT u.email INTO owner_email FROM public.listings l
    JOIN auth.users u ON u.id=l.user_id WHERE l.id=p_id;
  IF owner_email IS NULL THEN RETURN; END IF;
  IF owner_email NOT LIKE '%@example.edu' THEN
    RAISE EXCEPTION 'purge_test_listing only removes fixture data';
  END IF;
  DELETE FROM public.lock_ins WHERE listing_id=p_id;
  DELETE FROM public.listings WHERE id=p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_test_listing(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.purge_test_listing(uuid) TO service_role;

-- Losing trading privileges must never prevent an owner from reducing access.
CREATE OR REPLACE FUNCTION public.revoke_agent_mandate(p_mandate_id uuid)
RETURNS public.agent_mandates LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := auth.uid(); m public.agent_mandates%rowtype;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE='42501'; END IF;
  SELECT * INTO m FROM public.agent_mandates WHERE id=p_mandate_id FOR UPDATE;
  IF NOT FOUND OR m.owner_id <> v_user THEN RAISE EXCEPTION 'not your mandate'; END IF;
  IF m.status='consumed' THEN RAISE EXCEPTION 'deal already locked; use deal cancellation'; END IF;
  IF m.status='revoked' THEN RETURN m; END IF;
  UPDATE public.agent_mandates SET status='revoked',revoked_at=clock_timestamp()
    WHERE id=m.id RETURNING * INTO m;
  RETURN m;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_agent_capability(p_capability_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE='42501'; END IF;
  UPDATE public.agent_capabilities c SET revoked_at=coalesce(c.revoked_at,clock_timestamp())
    WHERE c.id=p_capability_id AND EXISTS (
      SELECT 1 FROM public.agent_mandates m WHERE m.id=c.mandate_id AND m.owner_id=v_user
    );
  IF NOT FOUND THEN RAISE EXCEPTION 'not your capability'; END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_agent_capability(p_mandate_id uuid,p_tools text[],p_expires_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := public._agent_human(); m public.agent_mandates%rowtype;
  c public.agent_capabilities%rowtype; v_token text;
BEGIN
  SELECT * INTO m FROM public.agent_mandates WHERE id=p_mandate_id FOR UPDATE;
  IF NOT FOUND OR m.owner_id <> v_user THEN RAISE EXCEPTION 'not your mandate'; END IF;
  IF m.status <> 'approved' OR m.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'approved active mandate required'; END IF;
  IF p_expires_at IS NULL OR p_expires_at <= clock_timestamp() OR p_expires_at > m.expires_at
    OR p_tools IS NULL OR cardinality(p_tools) NOT BETWEEN 1 AND 5
    OR NOT p_tools <@ ARRAY['place_offer','accept_offer','get_mandate','get_deal','revoke_mandate']::text[]
    OR array_position(p_tools,NULL) IS NOT NULL THEN RAISE EXCEPTION 'invalid capability scope'; END IF;
  -- Initial human validation may predate a mandate lock wait. Serialize with
  -- suspension only after the mandate lock, preserving mandate -> profile order.
  PERFORM id FROM public.profiles WHERE id=v_user FOR SHARE;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_user AND NOT is_suspended) THEN
    RAISE EXCEPTION 'signed-in, unsuspended human required';
  END IF;
  IF m.expires_at<=clock_timestamp() OR p_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'capability or mandate expired before issuance';
  END IF;
  v_token := 'swcap_' || encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO public.agent_capabilities(mandate_id,token_hash,tools,expires_at)
    VALUES(m.id,encode(extensions.digest(v_token,'sha256'),'hex'),p_tools,p_expires_at) RETURNING * INTO c;
  RETURN jsonb_build_object('id',c.id,'token',v_token,'expires_at',c.expires_at,'tools',c.tools);
END;
$$;

CREATE OR REPLACE FUNCTION public._agent_capability(p_token text,p_tool text)
RETURNS public.agent_capabilities LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.agent_capabilities%rowtype;
BEGIN
  IF p_token IS NULL OR p_token !~ '^swcap_[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid capability'; END IF;
  SELECT * INTO c FROM public.agent_capabilities
    WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex') FOR SHARE;
  IF NOT FOUND OR c.revoked_at IS NOT NULL OR c.expires_at <= clock_timestamp()
    OR NOT p_tool=ANY(c.tools) THEN RAISE EXCEPTION 'invalid, expired, revoked or unscoped capability'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.agent_mandates m JOIN public.profiles p ON p.id=m.owner_id
    WHERE m.id=c.mandate_id AND m.status IN ('approved','consumed')
      AND m.revoked_at IS NULL AND m.expires_at>clock_timestamp() AND NOT p.is_suspended
  ) THEN RAISE EXCEPTION 'mandate revoked, expired, unapproved or owner unavailable'; END IF;
  RETURN c;
END;
$$;

-- A revoke-only token must not gain the private fields behind get_mandate.
-- The signed-in human revoke RPC above still returns the owner's full row.
CREATE OR REPLACE FUNCTION public.agent_revoke_mandate(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.agent_capabilities%rowtype; m public.agent_mandates%rowtype;
BEGIN
  c:=public._agent_capability(p_token,'revoke_mandate');
  SELECT * INTO m FROM public.agent_mandates WHERE id=c.mandate_id FOR UPDATE;
  PERFORM public._agent_capability(p_token,'revoke_mandate');
  IF m.status='consumed' THEN RAISE EXCEPTION 'deal already locked; use deal cancellation'; END IF;
  UPDATE public.agent_mandates SET status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp())
    WHERE id=m.id RETURNING * INTO m;
  RETURN jsonb_build_object('id',m.id,'status',m.status);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_agent_mandate(uuid),public.revoke_agent_capability(uuid),
  public.issue_agent_capability(uuid,text[],timestamptz),public._agent_capability(text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.revoke_agent_mandate(uuid),public.revoke_agent_capability(uuid),
  public.issue_agent_capability(uuid,text[],timestamptz)
  TO authenticated;
REVOKE ALL ON FUNCTION public.agent_revoke_mandate(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.agent_revoke_mandate(text) TO anon,authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
