-- Additive M2 authority boundary. Apply only after the recovered baseline and
-- 202611050001_core_trade_authorization fixes pass their isolated-local gates.
-- Tokens can propose bounded trades. Only an authenticated human can approve.
BEGIN;
SET LOCAL ROLE postgres;

-- Reuse the recovered baseline's partial unique index on live deals.

CREATE TABLE public.agent_mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id),
  listing_id uuid NOT NULL REFERENCES public.listings(id),
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  bound_cents integer NOT NULL CHECK (bound_cents > 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  expires_at timestamptz NOT NULL,
  max_rounds integer NOT NULL CHECK (max_rounds BETWEEN 1 AND 100),
  rounds_used integer NOT NULL DEFAULT 0 CHECK (rounds_used BETWEEN 0 AND max_rounds),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'revoked', 'consumed')),
  listing_snapshot jsonb NOT NULL,
  draft_hash text NOT NULL CHECK (draft_hash ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id),
  revoked_at timestamptz,
  consumed_at timestamptz,
  deal_id uuid REFERENCES public.lock_ins(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
  CHECK (approved_by IS NULL OR approved_by = owner_id),
  CHECK (status <> 'approved' OR approved_at IS NOT NULL),
  CHECK (status <> 'consumed' OR (approved_at IS NOT NULL AND consumed_at IS NOT NULL AND deal_id IS NOT NULL)),
  CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);

CREATE TABLE public.agent_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id uuid NOT NULL REFERENCES public.agent_mandates(id),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  tools text[] NOT NULL CHECK (cardinality(tools) BETWEEN 1 AND 5
    AND tools <@ ARRAY['place_offer','accept_offer','get_mandate','get_deal','revoke_mandate']::text[]
    AND array_position(tools, NULL) IS NULL),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE public.mandate_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id uuid NOT NULL REFERENCES public.agent_mandates(id),
  capability_id uuid NOT NULL REFERENCES public.agent_capabilities(id),
  operation_key uuid NOT NULL,
  request_hash text NOT NULL,
  action text NOT NULL CHECK (action IN ('place_offer', 'accept_offer')),
  proposal jsonb NOT NULL,
  explanation text,
  model text,
  status text NOT NULL CHECK (status IN ('succeeded','rejected')),
  offer_id uuid UNIQUE REFERENCES public.offers(id),
  deal_id uuid REFERENCES public.lock_ins(id),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (mandate_id, operation_key)
);
CREATE INDEX agent_mandates_owner_created ON public.agent_mandates(owner_id, created_at DESC);
CREATE INDEX mandate_actions_mandate_created ON public.mandate_actions(mandate_id, created_at);

ALTER TABLE public.agent_mandates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mandate_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_mandates, public.agent_capabilities, public.mandate_actions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.agent_mandates, public.mandate_actions TO authenticated;
GRANT SELECT (id, mandate_id, tools, expires_at, revoked_at, created_at)
  ON public.agent_capabilities TO authenticated;
CREATE POLICY agent_mandates_owner_read ON public.agent_mandates FOR SELECT TO authenticated
  USING (owner_id = auth.uid());
CREATE POLICY agent_capabilities_owner_read ON public.agent_capabilities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agent_mandates m WHERE m.id = mandate_id AND m.owner_id = auth.uid()));
CREATE POLICY mandate_actions_owner_read ON public.mandate_actions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agent_mandates m WHERE m.id = mandate_id AND m.owner_id = auth.uid()));

CREATE FUNCTION public._agent_listing_snapshot(p_listing_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('id',l.id,'user_id',l.user_id,'type',l.type,
    'title',l.title,'description',l.description,'category_id',l.category_id,
    'event_date',l.event_date,'location',l.location)
  FROM public.listings l WHERE l.id = p_listing_id;
$$;

CREATE FUNCTION public._agent_mandate_terms_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF ROW(NEW.id,NEW.owner_id,NEW.listing_id,NEW.side,NEW.bound_cents,NEW.currency,
      NEW.expires_at,NEW.max_rounds,NEW.listing_snapshot,NEW.draft_hash,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.owner_id,OLD.listing_id,OLD.side,OLD.bound_cents,
      OLD.currency,OLD.expires_at,OLD.max_rounds,OLD.listing_snapshot,OLD.draft_hash,OLD.created_at)
    OR (OLD.approved_at IS NOT NULL AND ROW(NEW.approved_at,NEW.approved_by)
      IS DISTINCT FROM ROW(OLD.approved_at,OLD.approved_by)) THEN
    RAISE EXCEPTION 'mandate terms are immutable; create and approve a new draft';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER agent_mandate_terms_immutable BEFORE UPDATE ON public.agent_mandates
  FOR EACH ROW EXECUTE FUNCTION public._agent_mandate_terms_immutable();

CREATE FUNCTION public._agent_human() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user AND NOT is_suspended) THEN
    RAISE EXCEPTION 'signed-in, unsuspended human required';
  END IF;
  RETURN v_user;
END;
$$;

CREATE FUNCTION public.create_agent_mandate_draft(p_listing_id uuid,p_side text,
  p_bound_cents integer,p_expires_at timestamptz,p_max_rounds integer)
RETURNS public.agent_mandates LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := public._agent_human(); l public.listings%rowtype;
  m public.agent_mandates%rowtype; v_snapshot jsonb; v_hash text;
BEGIN
  IF p_side IS NULL OR p_side NOT IN ('buy','sell') OR p_bound_cents IS NULL OR p_bound_cents <= 0
    OR p_max_rounds IS NULL OR p_max_rounds NOT BETWEEN 1 AND 100
    OR p_expires_at IS NULL OR p_expires_at <= clock_timestamp()
    OR p_expires_at > clock_timestamp() + interval '7 days' THEN
    RAISE EXCEPTION 'invalid mandate terms';
  END IF;
  SELECT * INTO l FROM public.listings WHERE id = p_listing_id FOR SHARE;
  IF NOT FOUND OR l.status <> 'active' THEN RAISE EXCEPTION 'active listing required'; END IF;
  IF p_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'mandate draft expired while waiting for listing'; END IF;
  IF p_side <> (CASE WHEN (l.type = 'sell') = (l.user_id = v_user) THEN 'sell' ELSE 'buy' END) THEN
    RAISE EXCEPTION 'mandate side does not match listing role';
  END IF;
  -- Match the trading lock order; a suspension committed during either lock
  -- wait must invalidate this human authority operation too.
  PERFORM id FROM public.profiles WHERE id IN (v_user,l.user_id) ORDER BY id FOR SHARE;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_user AND NOT is_suspended)
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=l.user_id AND NOT is_suspended) THEN
    RAISE EXCEPTION 'human or listing owner unavailable';
  END IF;
  v_snapshot := public._agent_listing_snapshot(l.id);
  v_hash := encode(extensions.digest(jsonb_build_object('owner_id',v_user,'listing_id',l.id,
    'side',p_side,'bound_cents',p_bound_cents,'currency','USD','expires_at',p_expires_at,
    'max_rounds',p_max_rounds,'listing_snapshot',v_snapshot)::text,'sha256'),'hex');
  IF p_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'mandate draft expired before creation'; END IF;
  INSERT INTO public.agent_mandates(owner_id,listing_id,side,bound_cents,expires_at,max_rounds,listing_snapshot,draft_hash)
    VALUES(v_user,l.id,p_side,p_bound_cents,p_expires_at,p_max_rounds,v_snapshot,v_hash) RETURNING * INTO m;
  RETURN m;
END;
$$;

CREATE FUNCTION public.approve_agent_mandate(p_mandate_id uuid,p_expected_hash text)
RETURNS public.agent_mandates LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := public._agent_human(); m public.agent_mandates%rowtype; l public.listings%rowtype;
BEGIN
  SELECT * INTO m FROM public.agent_mandates WHERE id = p_mandate_id FOR UPDATE;
  IF NOT FOUND OR m.owner_id <> v_user THEN RAISE EXCEPTION 'not your mandate'; END IF;
  IF p_expected_hash IS NULL OR p_expected_hash <> m.draft_hash THEN RAISE EXCEPTION 'reviewed draft hash mismatch'; END IF;
  IF m.status NOT IN ('draft','approved') OR m.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'mandate cannot be approved'; END IF;
  SELECT * INTO l FROM public.listings WHERE id = m.listing_id FOR SHARE;
  IF m.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'mandate expired while waiting for listing'; END IF;
  IF l.status <> 'active' OR public._agent_listing_snapshot(l.id) IS DISTINCT FROM m.listing_snapshot THEN
    RAISE EXCEPTION 'listing changed or unavailable; create a new draft';
  END IF;
  PERFORM id FROM public.profiles WHERE id IN (v_user,l.user_id) ORDER BY id FOR SHARE;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_user AND NOT is_suspended)
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=l.user_id AND NOT is_suspended) THEN
    RAISE EXCEPTION 'human or listing owner unavailable';
  END IF;
  IF m.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'mandate expired before approval'; END IF;
  IF m.status = 'approved' THEN RETURN m; END IF;
  UPDATE public.agent_mandates SET status='approved',approved_at=clock_timestamp(),approved_by=v_user
    WHERE id=m.id RETURNING * INTO m;
  RETURN m;
END;
$$;

CREATE FUNCTION public.revoke_agent_mandate(p_mandate_id uuid) RETURNS public.agent_mandates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := public._agent_human(); m public.agent_mandates%rowtype;
BEGIN
  SELECT * INTO m FROM public.agent_mandates WHERE id=p_mandate_id FOR UPDATE;
  IF NOT FOUND OR m.owner_id <> v_user THEN RAISE EXCEPTION 'not your mandate'; END IF;
  IF m.status='consumed' THEN RAISE EXCEPTION 'deal already locked; use deal cancellation'; END IF;
  IF m.status='revoked' THEN RETURN m; END IF;
  UPDATE public.agent_mandates SET status='revoked',revoked_at=clock_timestamp() WHERE id=m.id RETURNING * INTO m;
  RETURN m;
END;
$$;

CREATE FUNCTION public.issue_agent_capability(p_mandate_id uuid,p_tools text[],p_expires_at timestamptz)
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
  v_token := 'swcap_' || encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO public.agent_capabilities(mandate_id,token_hash,tools,expires_at)
    VALUES(m.id,encode(extensions.digest(v_token,'sha256'),'hex'),p_tools,p_expires_at) RETURNING * INTO c;
  RETURN jsonb_build_object('id',c.id,'token',v_token,'expires_at',c.expires_at,'tools',c.tools);
END;
$$;

CREATE FUNCTION public.revoke_agent_capability(p_capability_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := public._agent_human();
BEGIN
  UPDATE public.agent_capabilities c SET revoked_at=coalesce(c.revoked_at,clock_timestamp())
    WHERE c.id=p_capability_id AND EXISTS (SELECT 1 FROM public.agent_mandates m WHERE m.id=c.mandate_id AND m.owner_id=v_user);
  IF NOT FOUND THEN RAISE EXCEPTION 'not your capability'; END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION public._agent_capability(p_token text,p_tool text) RETURNS public.agent_capabilities
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.agent_capabilities%rowtype;
BEGIN
  IF p_token IS NULL OR p_token !~ '^swcap_[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid capability'; END IF;
  SELECT * INTO c FROM public.agent_capabilities
    WHERE token_hash=encode(extensions.digest(p_token,'sha256'),'hex') FOR SHARE;
  IF NOT FOUND OR c.revoked_at IS NOT NULL OR c.expires_at <= clock_timestamp()
    OR NOT p_tool=ANY(c.tools) THEN RAISE EXCEPTION 'invalid, expired, revoked or unscoped capability'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agent_mandates WHERE id=c.mandate_id
      AND status IN ('approved','consumed') AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'mandate revoked, expired or unapproved';
  END IF;
  RETURN c;
END;
$$;

-- Assumes the caller holds the mandate row and listing lock. Never granted.
CREATE FUNCTION public._assert_agent_mandate(p_mandate_id uuid,p_amount_cents integer,p_check_round boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE m public.agent_mandates%rowtype; l public.listings%rowtype;
BEGIN
  SELECT * INTO m FROM public.agent_mandates WHERE id=p_mandate_id;
  IF NOT FOUND OR m.status <> 'approved' OR m.revoked_at IS NOT NULL OR m.expires_at <= clock_timestamp()
    OR (p_check_round AND m.rounds_used >= m.max_rounds) THEN RAISE EXCEPTION 'mandate inactive or round budget exhausted'; END IF;
  SELECT * INTO l FROM public.listings WHERE id=m.listing_id;
  IF l.status <> 'active' OR public._agent_listing_snapshot(l.id) IS DISTINCT FROM m.listing_snapshot
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=m.owner_id AND NOT is_suspended)
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=l.user_id AND NOT is_suspended) THEN
    RAISE EXCEPTION 'listing changed or participant unavailable';
  END IF;
  IF m.side <> (CASE WHEN (l.type='sell')=(l.user_id=m.owner_id) THEN 'sell' ELSE 'buy' END) THEN
    RAISE EXCEPTION 'mandate role no longer matches listing';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0
    OR (m.side='buy' AND p_amount_cents>m.bound_cents)
    OR (m.side='sell' AND p_amount_cents<m.bound_cents) THEN RAISE EXCEPTION 'price outside approved bound'; END IF;
END;
$$;

-- Called by manual accept_offer BEFORE its listing lock. No agent offer may
-- be accepted after its source authority has expired or been revoked.
CREATE OR REPLACE FUNCTION public._lock_agent_offer_mandate(p_offer_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_mandate uuid; o public.offers%rowtype; m public.agent_mandates%rowtype;
BEGIN
  SELECT mandate_id INTO v_mandate FROM public.mandate_actions WHERE offer_id=p_offer_id AND action='place_offer' AND status='succeeded';
  PERFORM set_config('sellwant.agent_offer_'||replace(p_offer_id::text,'-',''),coalesce(v_mandate::text,''),true);
  IF v_mandate IS NULL THEN RETURN; END IF;
  SELECT * INTO m FROM public.agent_mandates WHERE id=v_mandate FOR UPDATE;
  SELECT * INTO o FROM public.offers WHERE id=p_offer_id;
  IF o.from_user <> m.owner_id OR o.listing_id <> m.listing_id THEN RAISE EXCEPTION 'agent offer authority mismatch'; END IF;
  PERFORM public._assert_agent_mandate(m.id,o.amount_cents,false);
END;
$$;

CREATE OR REPLACE FUNCTION public._consume_agent_offer_mandate(p_offer_id uuid,p_deal_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE m public.agent_mandates%rowtype; o public.offers%rowtype; d public.lock_ins%rowtype;
BEGIN
  SELECT am.* INTO m FROM public.agent_mandates am JOIN public.mandate_actions a ON a.mandate_id=am.id
    WHERE a.offer_id=p_offer_id AND a.action='place_offer' AND a.status='succeeded';
  IF NOT FOUND THEN RETURN; END IF;
  -- A source transaction could become visible only after the initial lookup.
  -- Refuse a newly appeared mapping rather than acquiring a mandate lock after
  -- the listing lock. Only private prelock paths set this transaction marker.
  IF nullif(current_setting('sellwant.agent_offer_'||replace(p_offer_id::text,'-',''),true),'')
      IS DISTINCT FROM m.id::text THEN RAISE EXCEPTION 'offer authority changed; retry with a fresh operation'; END IF;
  -- Recheck after listing/offer lock waits. The insert trigger has already
  -- locked the listing, so this final check deliberately permits that state.
  SELECT * INTO o FROM public.offers WHERE id=p_offer_id;
  SELECT * INTO d FROM public.lock_ins WHERE id=p_deal_id;
  IF m.status<>'approved' OR m.revoked_at IS NOT NULL OR m.expires_at<=clock_timestamp()
    OR public._agent_listing_snapshot(m.listing_id) IS DISTINCT FROM m.listing_snapshot
    OR o.listing_id<>m.listing_id OR o.from_user<>m.owner_id OR d.listing_id<>m.listing_id
    OR d.locked_price_cents<>o.amount_cents
    OR (m.side='buy' AND (d.buyer_id<>m.owner_id OR o.amount_cents>m.bound_cents))
    OR (m.side='sell' AND (d.seller_id<>m.owner_id OR o.amount_cents<m.bound_cents))
    OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=m.owner_id AND NOT is_suspended) THEN
    RAISE EXCEPTION 'agent offer authority changed before deal lock';
  END IF;
  UPDATE public.agent_mandates SET status='consumed',consumed_at=clock_timestamp(),deal_id=p_deal_id WHERE id=m.id;
END;
$$;

CREATE FUNCTION public.agent_mandate_action(p_token text,p_operation_key uuid,p_action text,
  p_amount_cents integer DEFAULT NULL,p_offer_id uuid DEFAULT NULL,p_parent_offer_id uuid DEFAULT NULL,
  p_message text DEFAULT NULL,p_explanation text DEFAULT NULL,p_model text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.agent_capabilities%rowtype; m public.agent_mandates%rowtype;
  l public.listings%rowtype; o public.offers%rowtype; parent public.offers%rowtype;
  a public.mandate_actions%rowtype; v_source uuid; v_other uuid; v_amount integer;
  v_offer uuid; v_deal uuid; v_action_id uuid := gen_random_uuid(); v_hash text;
  v_proposal jsonb; v_result jsonb; v_error text;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('place_offer','accept_offer') OR p_operation_key IS NULL THEN
    RAISE EXCEPTION 'invalid action or operation key';
  END IF;
  c := public._agent_capability(p_token,p_action);
  -- Discover source authority without locking offers, then acquire ALL mandate
  -- locks in UUID order before the listing/offer/deal locks used by manual RPCs.
  IF p_action='accept_offer' THEN
    SELECT mandate_id INTO v_source FROM public.mandate_actions
      WHERE offer_id=p_offer_id AND action='place_offer' AND status='succeeded';
  END IF;
  PERFORM id FROM public.agent_mandates WHERE id=c.mandate_id OR id=v_source ORDER BY id FOR UPDATE;
  -- Replays disclose prior private results too. A shorter-lived capability
  -- must still be valid after waiting for mandate locks, before any replay.
  PERFORM public._agent_capability(p_token,p_action);
  IF p_action='accept_offer' AND p_offer_id IS NOT NULL THEN
    PERFORM set_config('sellwant.agent_offer_'||replace(p_offer_id::text,'-',''),coalesce(v_source::text,''),true);
  END IF;
  SELECT * INTO m FROM public.agent_mandates WHERE id=c.mandate_id;
  IF m.status='revoked' OR m.revoked_at IS NOT NULL OR m.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'mandate revoked or expired';
  END IF;
  IF length(coalesce(p_message,''))>2000 OR length(coalesce(p_explanation,''))>2000
    OR length(coalesce(p_model,''))>100 THEN RAISE EXCEPTION 'proposal text too long'; END IF;
  v_proposal := jsonb_build_object('action',p_action,'amount_cents',p_amount_cents,'offer_id',p_offer_id,
    'parent_offer_id',p_parent_offer_id,'message',p_message,'explanation',p_explanation,'model',p_model);
  v_hash := encode(extensions.digest(v_proposal::text,'sha256'),'hex');
  SELECT * INTO a FROM public.mandate_actions WHERE mandate_id=m.id AND operation_key=p_operation_key;
  IF FOUND THEN
    IF a.request_hash <> v_hash THEN RAISE EXCEPTION 'operation key reused with different proposal'; END IF;
    RETURN a.result;
  END IF;
  BEGIN
    SELECT * INTO l FROM public.listings WHERE id=m.listing_id FOR UPDATE;
    IF p_action='accept_offer' THEN
      SELECT * INTO o FROM public.offers WHERE id=p_offer_id;
      v_other:=CASE WHEN m.owner_id=l.user_id THEN o.from_user ELSE l.user_id END;
    ELSE
      SELECT * INTO parent FROM public.offers WHERE id=p_parent_offer_id;
      v_other:=CASE WHEN m.owner_id=l.user_id THEN parent.from_user ELSE l.user_id END;
    END IF;
    IF v_other IS NOT NULL THEN PERFORM public._assert_trade_participants(m.owner_id,v_other); END IF;
    IF p_action='place_offer' THEN
      IF p_offer_id IS NOT NULL THEN RAISE EXCEPTION 'place_offer cannot specify offer_id'; END IF;
      v_amount := p_amount_cents;
      PERFORM public._assert_agent_mandate(m.id,v_amount,true);
      IF p_parent_offer_id IS NOT NULL THEN
        SELECT * INTO parent FROM public.offers WHERE id=p_parent_offer_id FOR UPDATE;
        IF NOT FOUND OR parent.listing_id<>l.id OR parent.from_user=m.owner_id OR parent.status<>'open'
          OR (m.owner_id<>l.user_id AND parent.from_user<>l.user_id) THEN RAISE EXCEPTION 'invalid counteroffer parent'; END IF;
      ELSIF m.owner_id=l.user_id THEN RAISE EXCEPTION 'listing poster must counter a real opposing offer'; END IF;
      -- Token/mandate clocks must be checked again after all lock waits.
      PERFORM public._agent_capability(p_token,p_action);
      PERFORM public._assert_agent_mandate(m.id,v_amount,true);
      IF EXISTS (SELECT 1 FROM public.lock_ins WHERE listing_id=l.id AND state<>'cancelled') THEN RAISE EXCEPTION 'listing already has a deal'; END IF;
      INSERT INTO public.offers(listing_id,from_user,amount_cents,message,parent_offer_id)
        VALUES(l.id,m.owner_id,v_amount,p_message,p_parent_offer_id) RETURNING id INTO v_offer;
    ELSE
      IF p_amount_cents IS NOT NULL OR p_parent_offer_id IS NOT NULL OR p_message IS NOT NULL THEN
        RAISE EXCEPTION 'accept_offer uses exact stored offer terms';
      END IF;
      SELECT * INTO o FROM public.offers WHERE id=p_offer_id FOR UPDATE;
      IF NOT FOUND OR o.listing_id<>l.id OR o.status<>'open' OR o.from_user=m.owner_id THEN RAISE EXCEPTION 'offer unavailable or self trade'; END IF;
      IF m.owner_id=l.user_id THEN v_other:=o.from_user;
      ELSIF o.from_user=l.user_id AND o.parent_offer_id IS NOT NULL THEN
        SELECT * INTO parent FROM public.offers WHERE id=o.parent_offer_id FOR UPDATE;
        IF NOT FOUND OR parent.listing_id<>l.id OR parent.from_user<>m.owner_id OR parent.status<>'open' THEN
          RAISE EXCEPTION 'counteroffer is not addressed to mandate owner';
        END IF;
        v_other:=m.owner_id;
      ELSE RAISE EXCEPTION 'mandate owner cannot accept this offer'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_other AND NOT is_suspended) THEN RAISE EXCEPTION 'counterparty unavailable'; END IF;
      v_amount:=o.amount_cents;
      PERFORM public._assert_agent_mandate(m.id,v_amount,true);
      IF v_source IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.agent_mandates WHERE id=v_source AND owner_id=o.from_user AND listing_id=l.id) THEN
          RAISE EXCEPTION 'agent offer authority mismatch';
        END IF;
        PERFORM public._assert_agent_mandate(v_source,v_amount,false);
      END IF;
      PERFORM public._agent_capability(p_token,p_action);
      IF EXISTS (SELECT 1 FROM public.lock_ins WHERE listing_id=l.id AND state<>'cancelled') THEN RAISE EXCEPTION 'listing already has a deal'; END IF;
      INSERT INTO public.lock_ins(listing_id,buyer_id,seller_id,locked_price_cents)
        VALUES(l.id,CASE WHEN l.type='sell' THEN v_other ELSE l.user_id END,
          CASE WHEN l.type='sell' THEN l.user_id ELSE v_other END,v_amount) RETURNING id INTO v_deal;
      UPDATE public.offers SET status='accepted' WHERE id=o.id;
      PERFORM public._consume_agent_offer_mandate(o.id,v_deal);
    END IF;
    -- Existing offer/listing triggers may themselves wait on other offer rows.
    -- Recheck actor authority after those waits so an expired token/mandate
    -- cannot commit an insert that began while it was still valid.
    PERFORM public._agent_capability(p_token,p_action);
    IF m.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'mandate expired before action completed'; END IF;
    UPDATE public.agent_mandates SET rounds_used=rounds_used+1,
      status=CASE WHEN v_deal IS NULL THEN status ELSE 'consumed' END,
      consumed_at=CASE WHEN v_deal IS NULL THEN consumed_at ELSE clock_timestamp() END,
      deal_id=coalesce(v_deal,deal_id) WHERE id=m.id;
    v_result:=jsonb_strip_nulls(jsonb_build_object('id',v_action_id,'status','succeeded','offer_id',v_offer,'deal_id',v_deal));
  EXCEPTION WHEN raise_exception OR insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    v_offer:=NULL; v_deal:=NULL;
    v_result:=jsonb_build_object('id',v_action_id,'status','rejected','error',v_error);
  END;
  INSERT INTO public.mandate_actions(id,mandate_id,capability_id,operation_key,request_hash,action,
    proposal,explanation,model,status,offer_id,deal_id,result)
    VALUES(v_action_id,m.id,c.id,p_operation_key,v_hash,p_action,v_proposal,left(p_explanation,2000),left(p_model,100),
      v_result->>'status',v_offer,v_deal,v_result);
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.agent_get_mandate(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.agent_capabilities%rowtype; m public.agent_mandates%rowtype;
BEGIN
  c:=public._agent_capability(p_token,'get_mandate');
  SELECT * INTO m FROM public.agent_mandates WHERE id=c.mandate_id FOR SHARE;
  PERFORM public._agent_capability(p_token,'get_mandate');
  RETURN to_jsonb(m);
END;
$$;

CREATE FUNCTION public.agent_get_deal(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.agent_capabilities%rowtype; m public.agent_mandates%rowtype; d public.lock_ins%rowtype;
BEGIN
  c:=public._agent_capability(p_token,'get_deal');
  SELECT * INTO m FROM public.agent_mandates WHERE id=c.mandate_id FOR SHARE;
  PERFORM public._agent_capability(p_token,'get_deal');
  SELECT * INTO d FROM public.lock_ins WHERE id=m.deal_id AND (buyer_id=m.owner_id OR seller_id=m.owner_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id',d.id,'listing_id',d.listing_id,'locked_price_cents',d.locked_price_cents,
    'currency','USD','state',d.state,'locked_at',d.locked_at,'paid_at',d.paid_at,
    'confirmed_at',d.confirmed_at,'cancelled_at',d.cancelled_at);
END;
$$;

CREATE FUNCTION public.agent_revoke_mandate(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE c public.agent_capabilities%rowtype; m public.agent_mandates%rowtype;
BEGIN
  c:=public._agent_capability(p_token,'revoke_mandate');
  SELECT * INTO m FROM public.agent_mandates WHERE id=c.mandate_id FOR UPDATE;
  PERFORM public._agent_capability(p_token,'revoke_mandate');
  IF m.status='consumed' THEN RAISE EXCEPTION 'deal already locked; use deal cancellation'; END IF;
  UPDATE public.agent_mandates SET status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp())
    WHERE id=m.id RETURNING * INTO m;
  RETURN to_jsonb(m);
END;
$$;

-- Explicit function ACLs defeat Supabase's public default EXECUTE grant.
REVOKE ALL ON FUNCTION public._agent_listing_snapshot(uuid),public._agent_mandate_terms_immutable(),
  public._agent_human(),public._agent_capability(text,text),public._assert_agent_mandate(uuid,integer,boolean),
  public._lock_agent_offer_mandate(uuid),public._consume_agent_offer_mandate(uuid,uuid),
  public.create_agent_mandate_draft(uuid,text,integer,timestamptz,integer),public.approve_agent_mandate(uuid,text),
  public.revoke_agent_mandate(uuid),public.issue_agent_capability(uuid,text[],timestamptz),public.revoke_agent_capability(uuid),
  public.agent_mandate_action(text,uuid,text,integer,uuid,uuid,text,text,text),
  public.agent_get_mandate(text),public.agent_get_deal(text),public.agent_revoke_mandate(text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_agent_mandate_draft(uuid,text,integer,timestamptz,integer),
  public.approve_agent_mandate(uuid,text),public.revoke_agent_mandate(uuid),
  public.issue_agent_capability(uuid,text[],timestamptz),public.revoke_agent_capability(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_mandate_action(text,uuid,text,integer,uuid,uuid,text,text,text),
  public.agent_get_mandate(text),public.agent_get_deal(text),public.agent_revoke_mandate(text) TO anon,authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
