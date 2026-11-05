-- Minimal bearer-capability authentication context for the product MCP route.
-- Scope discovery grants no action; each scoped RPC revalidates its authority.
BEGIN;
SET LOCAL ROLE postgres;

CREATE FUNCTION public.agent_get_access(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.agent_capabilities%rowtype; v_tools text[]; v_tool text; v_owner uuid;
BEGIN
  IF p_token IS NULL OR p_token !~ '^swcap_[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid capability' USING ERRCODE='42501';
  END IF;
  SELECT tools INTO v_tools FROM public.agent_capabilities
    WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
  IF NOT FOUND OR v_tools IS NULL OR cardinality(v_tools) NOT BETWEEN 1 AND 5
    OR array_ndims(v_tools)<>1 OR array_position(v_tools,NULL) IS NOT NULL
    OR NOT v_tools <@ ARRAY['place_offer','accept_offer','get_mandate','get_deal','revoke_mandate']::text[] THEN
    RAISE EXCEPTION 'invalid capability' USING ERRCODE='42501';
  END IF;
  v_tool:=v_tools[array_lower(v_tools,1)];
  -- Choose an actual granted scope. Authentication must also work for tokens
  -- that have no get_mandate privilege, without granting that private read.
  c:=public._agent_capability(p_token,v_tool);
  IF c.tools IS DISTINCT FROM v_tools THEN
    RAISE EXCEPTION 'capability changed; retry' USING ERRCODE='42501';
  END IF;
  -- Stabilize revocation and suspension in the established lock order. The
  -- helper recheck also evaluates real clocks after either lock wait.
  SELECT owner_id INTO v_owner FROM public.agent_mandates WHERE id=c.mandate_id FOR SHARE;
  PERFORM id FROM public.profiles WHERE id=v_owner FOR SHARE;
  c:=public._agent_capability(p_token,v_tool);
  RETURN jsonb_build_object('id',c.id,'mandate_id',c.mandate_id,'tools',c.tools,'expires_at',c.expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.agent_get_access(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.agent_get_access(text) TO anon,authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
