-- Apply only after the recovered source baseline has compared successfully.
-- All manual trading writes acquire listing -> profiles -> offers -> deal.
BEGIN;
SET LOCAL ROLE postgres;

-- TRUNCATE bypasses RLS; these grants were present in the recovered baseline.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE ON TABLES FROM PUBLIC, anon, authenticated;

-- Canonical RPCs derive price/parties/state and serialize every offer mutation.
REVOKE INSERT, UPDATE, DELETE ON public.lock_ins FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.offers FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (status) ON public.offers FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._assert_trade_participants(p_first uuid, p_second uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_first IS NULL OR p_second IS NULL OR p_first = p_second THEN
    RAISE EXCEPTION 'two distinct participants are required' USING ERRCODE = '42501';
  END IF;
  PERFORM id FROM public.profiles WHERE id IN (p_first, p_second) ORDER BY id FOR SHARE;
  IF (SELECT count(*) FROM public.profiles WHERE id IN (p_first, p_second) AND NOT is_suspended) <> 2 THEN
    RAISE EXCEPTION 'participant unavailable or suspended' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- The mandate migration replaces these private hooks. A manual acceptance of
-- an agent-origin offer must validate its source mandate before locking listing
-- and consume it only after all trading checks have passed.
CREATE OR REPLACE FUNCTION public._lock_agent_offer_mandate(p_offer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RETURN; END;
$$;
CREATE OR REPLACE FUNCTION public._consume_agent_offer_mandate(p_offer_id uuid, p_deal_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN RETURN; END;
$$;

CREATE OR REPLACE FUNCTION public.create_lock_in(p_listing_id uuid, p_expected_price_cents integer)
RETURNS public.lock_ins LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  l public.listings%ROWTYPE;
  d public.lock_ins%ROWTYPE;
  v_buyer uuid;
  v_seller uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'listing not found'; END IF;
  v_buyer := CASE WHEN l.type = 'sell' THEN v_uid ELSE l.user_id END;
  v_seller := CASE WHEN l.type = 'sell' THEN l.user_id ELSE v_uid END;
  PERFORM public._assert_trade_participants(v_buyer, v_seller);
  IF p_expected_price_cents IS NULL OR p_expected_price_cents <> l.price_cents THEN
    RAISE EXCEPTION 'listing price changed; review the current price';
  END IF;
  SELECT * INTO d FROM public.lock_ins WHERE listing_id = l.id AND state <> 'cancelled' FOR UPDATE;
  IF FOUND THEN
    IF d.buyer_id = v_buyer AND d.seller_id = v_seller AND d.locked_price_cents = p_expected_price_cents THEN RETURN d; END IF;
    RAISE EXCEPTION 'this listing already has a deal in progress';
  END IF;
  IF l.status <> 'active' THEN RAISE EXCEPTION 'listing is no longer active'; END IF;
  INSERT INTO public.lock_ins(listing_id,buyer_id,seller_id,locked_price_cents)
    VALUES(l.id,v_buyer,v_seller,l.price_cents) RETURNING * INTO d;
  RETURN d;
END;
$$;

CREATE OR REPLACE FUNCTION public.place_offer(
  p_listing_id uuid, p_amount_cents integer, p_message text DEFAULT NULL, p_parent_offer_id uuid DEFAULT NULL
)
RETURNS public.offers LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  l public.listings%ROWTYPE;
  parent public.offers%ROWTYPE;
  o public.offers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RAISE EXCEPTION 'positive integer cents required'; END IF;
  SELECT * INTO l FROM public.listings WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'listing not found'; END IF;
  IF l.status <> 'active' THEN RAISE EXCEPTION 'listing is no longer active'; END IF;
  IF p_parent_offer_id IS NOT NULL THEN
    SELECT * INTO parent FROM public.offers WHERE id = p_parent_offer_id;
    IF NOT FOUND OR parent.listing_id <> l.id OR parent.from_user = v_uid OR parent.status <> 'open' THEN
      RAISE EXCEPTION 'counter must answer another open offer on this listing';
    END IF;
    IF v_uid <> l.user_id AND parent.from_user <> l.user_id THEN
      RAISE EXCEPTION 'counter must answer the listing poster';
    END IF;
  ELSIF v_uid = l.user_id THEN
    RAISE EXCEPTION 'poster may only counter a real offer';
  END IF;
  PERFORM public._assert_trade_participants(l.user_id, CASE WHEN v_uid = l.user_id THEN parent.from_user ELSE v_uid END);
  PERFORM id FROM public.offers WHERE listing_id=l.id AND (from_user=v_uid OR id=p_parent_offer_id) ORDER BY id FOR UPDATE;
  INSERT INTO public.offers(listing_id,from_user,amount_cents,message,parent_offer_id)
    VALUES(l.id,v_uid,p_amount_cents,nullif(btrim(p_message),''),p_parent_offer_id) RETURNING * INTO o;
  RETURN o;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_offer_status(p_offer_id uuid, p_to text)
RETURNS public.offers LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_listing_id uuid;
  l public.listings%ROWTYPE;
  o public.offers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501'; END IF;
  SELECT listing_id INTO v_listing_id FROM public.offers WHERE id = p_offer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not found'; END IF;
  SELECT * INTO l FROM public.listings WHERE id = v_listing_id FOR UPDATE;
  SELECT * INTO o FROM public.offers WHERE id = p_offer_id;
  IF p_to = 'withdrawn' THEN
    IF o.from_user <> v_uid THEN RAISE EXCEPTION 'not your offer' USING ERRCODE = '42501'; END IF;
  ELSIF p_to = 'declined' THEN
    IF l.user_id <> v_uid OR o.from_user = v_uid THEN RAISE EXCEPTION 'not an incoming offer' USING ERRCODE = '42501'; END IF;
  ELSE RAISE EXCEPTION 'only withdrawal or decline is allowed'; END IF;
  IF o.status = p_to THEN RETURN o; END IF;
  IF l.status <> 'active' OR o.status <> 'open' THEN RAISE EXCEPTION 'offer is no longer open'; END IF;
  UPDATE public.offers SET status = p_to WHERE id = o.id RETURNING * INTO o;
  RETURN o;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_offer(p_offer_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_listing_id uuid;
  l public.listings%ROWTYPE;
  o public.offers%ROWTYPE;
  parent public.offers%ROWTYPE;
  v_counterparty uuid;
  v_lock_in uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501'; END IF;
  PERFORM public._lock_agent_offer_mandate(p_offer_id);
  SELECT listing_id INTO v_listing_id FROM public.offers WHERE id = p_offer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not found'; END IF;
  SELECT * INTO l FROM public.listings WHERE id = v_listing_id FOR UPDATE;
  IF l.status <> 'active' THEN RAISE EXCEPTION 'listing is no longer active'; END IF;
  -- The first lookup only locates the lock. All authoritative offer fields are
  -- reread after the listing lock, closing acceptance-vs-withdrawal races.
  SELECT * INTO o FROM public.offers WHERE id = p_offer_id;
  IF NOT FOUND OR o.status <> 'open' THEN RAISE EXCEPTION 'offer is no longer open'; END IF;
  IF o.from_user = l.user_id THEN
    SELECT * INTO parent FROM public.offers WHERE id = o.parent_offer_id;
    IF NOT FOUND OR parent.listing_id <> l.id OR parent.status <> 'open' OR parent.from_user <> v_uid OR v_uid = l.user_id THEN
      RAISE EXCEPTION 'not the recipient of this counteroffer' USING ERRCODE = '42501';
    END IF;
    v_counterparty := v_uid;
  ELSE
    IF l.user_id <> v_uid THEN RAISE EXCEPTION 'not your listing' USING ERRCODE = '42501'; END IF;
    v_counterparty := o.from_user;
  END IF;
  PERFORM public._assert_trade_participants(l.user_id, v_counterparty);
  PERFORM id FROM public.offers WHERE listing_id=l.id ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.lock_ins WHERE listing_id = l.id AND state <> 'cancelled') THEN
    RAISE EXCEPTION 'this listing already has a deal in progress';
  END IF;
  INSERT INTO public.lock_ins(listing_id,buyer_id,seller_id,locked_price_cents)
    VALUES(l.id, CASE WHEN l.type = 'sell' THEN v_counterparty ELSE l.user_id END,
      CASE WHEN l.type = 'sell' THEN l.user_id ELSE v_counterparty END, o.amount_cents)
    RETURNING id INTO v_lock_in;
  UPDATE public.offers SET status = 'accepted' WHERE id = o.id;
  -- This hook revalidates source authority after any lock wait and rolls back
  -- the entire acceptance if its mandate expired/revoked/changed meanwhile.
  PERFORM public._consume_agent_offer_mandate(p_offer_id, v_lock_in);
  RETURN v_lock_in;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_listing(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.listings%ROWTYPE; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.listings WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such listing'; END IF;
  IF v.user_id <> v_uid THEN RAISE EXCEPTION 'not your listing' USING ERRCODE = '42501'; END IF;
  IF v.status <> 'active' THEN RAISE EXCEPTION 'this listing is % and cannot be taken down here', v.status; END IF;
  UPDATE public.listings SET status = 'cancelled' WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_deal(p_lock_in_id uuid, p_to text)
RETURNS public.lock_ins LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d public.lock_ins%ROWTYPE;
  v_uid uuid := auth.uid();
  v_listing_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501'; END IF;
  SELECT listing_id INTO v_listing_id FROM public.lock_ins WHERE id = p_lock_in_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'deal not found'; END IF;
  PERFORM id FROM public.listings WHERE id = v_listing_id FOR UPDATE;
  SELECT * INTO d FROM public.lock_ins WHERE id = p_lock_in_id FOR UPDATE;
  IF v_uid NOT IN (d.buyer_id,d.seller_id) THEN RAISE EXCEPTION 'not your deal' USING ERRCODE = '42501'; END IF;
  IF p_to <> 'cancelled' AND public.is_suspended() THEN RAISE EXCEPTION 'account suspended' USING ERRCODE = '42501'; END IF;
  IF d.state = p_to THEN RETURN d; END IF;
  IF d.state IN ('confirmed','cancelled') THEN RAISE EXCEPTION 'this deal is already %',d.state; END IF;
  IF p_to = 'paid' THEN
    IF v_uid <> d.buyer_id THEN RAISE EXCEPTION 'only the buyer can mark a deal paid'; END IF;
    IF d.state <> 'pending_payment' THEN RAISE EXCEPTION 'cannot mark paid from %',d.state; END IF;
    UPDATE public.lock_ins SET state='paid',paid_at=now() WHERE id=d.id RETURNING * INTO d;
  ELSIF p_to = 'confirmed' THEN
    IF v_uid <> d.buyer_id THEN RAISE EXCEPTION 'only the buyer can confirm a deal'; END IF;
    IF d.state <> 'paid' THEN RAISE EXCEPTION 'mark the deal paid first'; END IF;
    UPDATE public.lock_ins SET state='confirmed',confirmed_at=now() WHERE id=d.id RETURNING * INTO d;
  ELSIF p_to = 'cancelled' THEN
    UPDATE public.lock_ins SET state='cancelled',cancelled_by=v_uid,cancelled_at=now(),cancelled_from=d.state
      WHERE id=d.id RETURNING * INTO d;
  ELSE RAISE EXCEPTION 'unknown target state %',p_to; END IF;
  RETURN d;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_trade_participants(uuid,uuid), public._lock_agent_offer_mandate(uuid),
  public._consume_agent_offer_mandate(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_lock_in(uuid,integer),public.place_offer(uuid,integer,text,uuid),
  public.set_offer_status(uuid,text),public.accept_offer(uuid),public.cancel_listing(uuid),public.advance_deal(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_lock_in(uuid,integer),public.place_offer(uuid,integer,text,uuid),
  public.set_offer_status(uuid,text),public.accept_offer(uuid),public.cancel_listing(uuid),public.advance_deal(uuid,text)
  TO authenticated,service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
