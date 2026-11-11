-- A buyer could void the PayPal hold after confirming they had the ticket.
--
-- Capture needs both human handoffs, but cancel had no rule tied to them. So
-- the buyer could confirm the handoff, the seller could hand the ticket over on
-- the strength of that confirmation, and then the buyer could POST
-- {"action":"cancel"} before anyone pressed capture: the authorization was
-- voided, the deal cancelled under the buyer's name, the listing reopened, and
-- the seller's capture returned done with no money.
--
-- Reproduced in a sandboxed PostgreSQL with migrations through 0005 and with
-- the Worker's own runPaymentLease against the PayPal fixture: one void call,
-- zero captures, payment cancelled, deal cancelled, listing active.
--
-- The fix makes the buyer's attestation binding in the one place every cancel
-- passes through. The seller can still release the hold, and expiry recovery
-- (p_action='recover', actor NULL) still voids an abandoned hold. The Worker
-- and UI need no change to be safe; the UI stops offering the button
-- separately (lib/deal-payments.ts).
--
-- The body below is 202611050005's claim_deal_payment verbatim plus the one
-- rule marked above. CREATE OR REPLACE keeps the existing service_role-only
-- grants.

CREATE OR REPLACE FUNCTION public.claim_deal_payment(
  p_deal_id uuid,p_actor uuid,p_action text,p_demo_seller_id uuid,p_merchant_id text,p_app_origin text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.lock_ins; p public.deal_payments; lid uuid; op text; lease uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service required' USING ERRCODE='42501'; END IF;
  IF p_action NOT IN ('create','authorize','capture','cancel','reconcile','recover') THEN
    RAISE EXCEPTION 'unknown action'; END IF;
  SELECT listing_id INTO lid FROM public.lock_ins WHERE id=p_deal_id;
  PERFORM id FROM public.listings WHERE id=lid FOR UPDATE;
  SELECT * INTO d FROM public.lock_ins WHERE id=p_deal_id;
  PERFORM id FROM public.profiles WHERE id IN (d.buyer_id,d.seller_id) ORDER BY id FOR SHARE;
  SELECT * INTO d FROM public.lock_ins WHERE id=p_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'deal unavailable' USING ERRCODE='42501'; END IF;
  IF p_action <> 'recover' AND (p_actor IS NULL OR p_actor NOT IN (d.buyer_id,d.seller_id)) THEN
    RAISE EXCEPTION 'deal unavailable' USING ERRCODE='42501'; END IF;
  IF p_action='recover' AND p_actor IS NOT NULL THEN RAISE EXCEPTION 'invalid recovery actor'; END IF;
  IF p_action IN ('create','authorize') AND p_actor <> d.buyer_id THEN
    RAISE EXCEPTION 'buyer required' USING ERRCODE='42501'; END IF;
  IF p_action IN ('create','authorize','capture') AND EXISTS
    (SELECT 1 FROM public.profiles WHERE id IN (d.buyer_id,d.seller_id) AND is_suspended) THEN
    RAISE EXCEPTION 'participant unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM public.deal_payments WHERE deal_id=d.id FOR UPDATE;
  IF NOT FOUND THEN
    IF p_action <> 'create' OR d.state <> 'pending_payment' OR d.seller_id IS DISTINCT FROM p_demo_seller_id
      OR p_merchant_id IS NULL OR p_merchant_id !~ '^[A-Za-z0-9]{1,64}$'
      OR p_app_origin IS NULL OR p_app_origin !~ '^(https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?|http://(127[.]0[.]0[.]1|localhost|\[::1\])(:[0-9]{1,5})?)$'
      OR p_app_origin ~ '^https?://(www[.])?sellwant[.]com(:|$)' THEN
      RAISE EXCEPTION 'sandbox payment is unavailable for this deal'; END IF;
    INSERT INTO public.deal_payments(deal_id,buyer_id,seller_id,amount_cents,merchant_id,create_payload)
      VALUES(d.id,d.buyer_id,d.seller_id,d.locked_price_cents,p_merchant_id,
        jsonb_build_object('intent','AUTHORIZE','purchase_units',jsonb_build_array(jsonb_build_object(
          'reference_id',d.id::text,'custom_id',d.id::text,'invoice_id',d.id::text,
          'amount',jsonb_build_object('currency_code','USD','value',(d.locked_price_cents/100)::text||'.'||lpad((d.locked_price_cents%100)::text,2,'0')),
          'payee',jsonb_build_object('merchant_id',p_merchant_id))),
          'payment_source',jsonb_build_object('paypal',jsonb_build_object('experience_context',jsonb_build_object(
            'shipping_preference','NO_SHIPPING','user_action','PAY_NOW',
            'return_url',p_app_origin||'/deal/'||d.id::text,'cancel_url',p_app_origin||'/deal/'||d.id::text))))) RETURNING * INTO p;
  END IF;
  IF p.buyer_id<>d.buyer_id OR p.seller_id<>d.seller_id OR p.amount_cents<>d.locked_price_cents
    OR p.merchant_id IS DISTINCT FROM p_merchant_id OR p.seller_id IS DISTINCT FROM p_demo_seller_id THEN
    RAISE EXCEPTION 'immutable payment association mismatch'; END IF;
  IF p.status IN ('captured','cancelled') THEN RETURN jsonb_build_object('done',true); END IF;
  -- The buyer's handoff confirmation is what the seller relies on to hand the
  -- ticket over. Once the buyer has given it, the buyer may not void the hold
  -- and walk away with the ticket: only the seller (forgoing payment) or
  -- expiry recovery can release it.
  IF p_action='cancel' AND p_actor=d.buyer_id AND p.buyer_handoff_at IS NOT NULL THEN
    RAISE EXCEPTION 'buyer confirmed the handoff; only the seller can release this hold' USING ERRCODE='42501'; END IF;
  IF d.state <> 'pending_payment' THEN RAISE EXCEPTION 'deal state conflicts with payment'; END IF;
  IF p.lease_until > clock_timestamp() THEN RETURN jsonb_build_object('busy',true); END IF;
  IF p.pending_operation IS NOT NULL THEN
    -- An expired lease never permits the opposing financial mutation.
    IF p_action NOT IN ('recover','reconcile') THEN
      RETURN jsonb_build_object('reconciliation_required',true); END IF;
    op := 'reconcile';
  ELSIF p_action='recover' THEN
    IF p.expires_at > clock_timestamp() AND
      (p.authorization_expires_at IS NULL OR p.authorization_expires_at>clock_timestamp()) THEN
      RETURN jsonb_build_object('done',true); END IF;
    op := 'cancel';
  ELSIF p_action='reconcile' THEN op := 'reconcile';
  ELSE op := p_action;
  END IF;
  IF op='create' AND p.order_id IS NOT NULL THEN RETURN jsonb_build_object('done',true); END IF;
  IF op='authorize' AND p.status='authorized' THEN RETURN jsonb_build_object('done',true); END IF;
  IF op='authorize' AND (p.order_id IS NULL OR p.expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION 'unexpired order required'; END IF;
  IF op='capture' AND (p.status<>'authorized' OR p.authorization_id IS NULL
    OR p.buyer_handoff_at IS NULL OR p.seller_handoff_at IS NULL
    OR p.expires_at<=clock_timestamp() OR p.authorization_expires_at IS NULL OR p.authorization_expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION 'both human handoffs and an unexpired hold are required'; END IF;
  lease := gen_random_uuid();
  UPDATE public.deal_payments SET
    pending_operation=coalesce(pending_operation,op),
    operation_started_at=CASE WHEN pending_operation IS NULL THEN clock_timestamp() ELSE operation_started_at END,
    lease_token=lease,lease_until=clock_timestamp()+interval '2 minutes',lease_action=op,
    authorize_requested_at=CASE WHEN op='authorize' THEN coalesce(authorize_requested_at,clock_timestamp()) ELSE authorize_requested_at END,
    capture_requested_at=CASE WHEN op='capture' THEN coalesce(capture_requested_at,clock_timestamp()) ELSE capture_requested_at END,
    cancelled_by=CASE WHEN op='cancel' THEN p_actor ELSE cancelled_by END,
    updated_at=now() WHERE deal_id=d.id RETURNING * INTO p;
  RETURN to_jsonb(p);
END;
$$;
