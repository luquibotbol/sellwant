-- Additive sandbox-only payment ledger. Apply only to the isolated recovered DB.
BEGIN;
SET LOCAL ROLE postgres;

CREATE TABLE public.deal_payments (
  deal_id uuid PRIMARY KEY REFERENCES public.lock_ins(id) ON DELETE RESTRICT,
  buyer_id uuid NOT NULL REFERENCES public.profiles(id),
  seller_id uuid NOT NULL REFERENCES public.profiles(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  merchant_id text NOT NULL CHECK (merchant_id ~ '^[A-Za-z0-9]{1,64}$'),
  status text NOT NULL DEFAULT 'creating' CHECK (status IN
    ('creating','approval_required','authorized','captured','cancelled','unknown')),
  order_id text UNIQUE CHECK (order_id ~ '^[A-Za-z0-9]{1,64}$'),
  authorization_id text UNIQUE CHECK (authorization_id ~ '^[A-Za-z0-9]{1,64}$'),
  capture_id text UNIQUE CHECK (capture_id ~ '^[A-Za-z0-9]{1,64}$'),
  approval_url text,
  provider_status text,
  authorization_expires_at timestamptz CHECK (authorization_expires_at IS NULL OR isfinite(authorization_expires_at)),
  authorize_requested_at timestamptz,
  authorized_at timestamptz,
  buyer_handoff_at timestamptz,
  seller_handoff_at timestamptz,
  capture_requested_at timestamptz,
  cancelled_by uuid REFERENCES public.profiles(id),
  create_request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  create_payload jsonb NOT NULL CHECK (jsonb_typeof(create_payload)='object'),
  authorize_request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  capture_request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  void_request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  pending_operation text CHECK (pending_operation IN ('create','authorize','capture','cancel','reconcile')),
  operation_started_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  lease_action text CHECK (lease_action IN ('create','authorize','capture','cancel','reconcile')),
  next_reconcile_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes') CHECK (isfinite(expires_at)),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_id <> seller_id),
  CHECK (status<>'authorized' OR (authorization_id IS NOT NULL AND authorization_expires_at IS NOT NULL
    AND authorize_requested_at IS NOT NULL AND authorized_at IS NOT NULL)),
  CHECK (status <> 'captured' OR (capture_id IS NOT NULL AND buyer_handoff_at IS NOT NULL
    AND seller_handoff_at IS NOT NULL AND capture_requested_at IS NOT NULL))
);
ALTER TABLE public.deal_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deal_payments FROM PUBLIC, anon, authenticated, service_role;
CREATE POLICY deal_payment_participant ON public.deal_payments FOR SELECT TO authenticated
  USING (auth.uid() IN (buyer_id,seller_id));
-- Approval URLs are only returned to the buyer by the human RPC below.
GRANT SELECT (deal_id,buyer_id,seller_id,amount_cents,currency,status,provider_status,
  authorization_expires_at,buyer_handoff_at,seller_handoff_at,capture_requested_at,
  expires_at,updated_at) ON public.deal_payments TO authenticated;
CREATE INDEX deal_payments_recovery ON public.deal_payments(next_reconcile_at,expires_at)
  WHERE status NOT IN ('captured','cancelled');

CREATE FUNCTION public._payment_public(p public.deal_payments, p_buyer boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('deal_id',p.deal_id,'status',p.status,'amount_cents',p.amount_cents,
    'currency',p.currency,'approval_url',CASE WHEN p_buyer THEN p.approval_url ELSE NULL END,
    'provider_status',p.provider_status,'authorization_expires_at',p.authorization_expires_at,
    'buyer_handoff_at',p.buyer_handoff_at,'seller_handoff_at',p.seller_handoff_at,
    'capture_requested_at',p.capture_requested_at,'expires_at',p.expires_at,'updated_at',p.updated_at);
$$;

CREATE FUNCTION public.get_deal_payment(p_deal_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.lock_ins; p public.deal_payments;
BEGIN
  IF auth.uid() IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'human sign in required' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM public.lock_ins WHERE id=p_deal_id;
  IF NOT FOUND OR auth.uid() NOT IN (d.buyer_id,d.seller_id) THEN
    RAISE EXCEPTION 'deal unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM public.deal_payments WHERE deal_id=d.id;
  RETURN jsonb_build_object('deal_id',d.id,'buyer_id',d.buyer_id,'seller_id',d.seller_id,
    'amount_cents',d.locked_price_cents,'deal_state',d.state,
    'payment',CASE WHEN p.deal_id IS NULL THEN NULL ELSE public._payment_public(p,auth.uid()=d.buyer_id) END);
END;
$$;

CREATE FUNCTION public.confirm_deal_payment_handoff(p_deal_id uuid, p_confirmed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.lock_ins; p public.deal_payments; lid uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.role() <> 'authenticated' OR p_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'explicit human confirmation required' USING ERRCODE='42501'; END IF;
  SELECT listing_id INTO lid FROM public.lock_ins WHERE id=p_deal_id;
  PERFORM id FROM public.listings WHERE id=lid FOR UPDATE;
  SELECT * INTO d FROM public.lock_ins WHERE id=p_deal_id;
  IF NOT FOUND OR auth.uid() NOT IN (d.buyer_id,d.seller_id) THEN
    RAISE EXCEPTION 'deal unavailable' USING ERRCODE='42501'; END IF;
  PERFORM public._assert_trade_participants(d.buyer_id,d.seller_id);
  SELECT * INTO d FROM public.lock_ins WHERE id=p_deal_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() NOT IN (d.buyer_id,d.seller_id) THEN
    RAISE EXCEPTION 'deal unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM public.deal_payments WHERE deal_id=d.id FOR UPDATE;
  IF NOT FOUND OR p.status <> 'authorized' OR p.pending_operation IS NOT NULL
      OR d.state <> 'pending_payment' OR p.expires_at <= clock_timestamp()
      OR p.authorization_expires_at IS NULL OR p.authorization_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'a verified unexpired hold is required'; END IF;
  UPDATE public.deal_payments SET
    buyer_handoff_at=CASE WHEN auth.uid()=buyer_id THEN coalesce(buyer_handoff_at,clock_timestamp()) ELSE buyer_handoff_at END,
    seller_handoff_at=CASE WHEN auth.uid()=seller_id THEN coalesce(seller_handoff_at,clock_timestamp()) ELSE seller_handoff_at END,
    updated_at=now() WHERE deal_id=d.id RETURNING * INTO p;
  RETURN public._payment_public(p,auth.uid()=d.buyer_id);
END;
$$;

-- Only the Worker service principal may claim. p_actor is derived from a
-- separately verified human /auth/v1/user response, never an agent capability.
CREATE FUNCTION public.claim_deal_payment(
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

-- Save a returned resource ID before any additional provider request. A stale
-- worker cannot record against a lease taken over by a recovery worker.
CREATE FUNCTION public.record_deal_payment_resource(
  p_deal_id uuid,p_lease_token uuid,p_kind text,p_resource_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.deal_payments; existing text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service required' USING ERRCODE='42501'; END IF;
  SELECT * INTO p FROM public.deal_payments WHERE deal_id=p_deal_id FOR UPDATE;
  IF NOT FOUND OR p.lease_token IS DISTINCT FROM p_lease_token OR p.lease_until<=clock_timestamp() THEN
    RAISE EXCEPTION 'payment lease lost'; END IF;
  IF p_resource_id IS NULL OR p_resource_id !~ '^[A-Za-z0-9]{1,64}$' OR p_kind NOT IN ('order','authorization','capture') THEN
    RAISE EXCEPTION 'invalid resource'; END IF;
  existing := CASE p_kind WHEN 'order' THEN p.order_id WHEN 'authorization' THEN p.authorization_id ELSE p.capture_id END;
  IF existing IS NOT NULL AND existing<>p_resource_id THEN RAISE EXCEPTION 'immutable provider association mismatch'; END IF;
  UPDATE public.deal_payments SET order_id=CASE WHEN p_kind='order' THEN p_resource_id ELSE order_id END,
    authorization_id=CASE WHEN p_kind='authorization' THEN p_resource_id ELSE authorization_id END,
    capture_id=CASE WHEN p_kind='capture' THEN p_resource_id ELSE capture_id END,updated_at=now()
    WHERE deal_id=p_deal_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.finish_deal_payment(p_deal_id uuid,p_lease_token uuid,p_result jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.lock_ins; p public.deal_payments; lid uuid; target text; provider text; expiry timestamptz;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service required' USING ERRCODE='42501'; END IF;
  SELECT listing_id INTO lid FROM public.lock_ins WHERE id=p_deal_id;
  PERFORM id FROM public.listings WHERE id=lid FOR UPDATE;
  SELECT * INTO d FROM public.lock_ins WHERE id=p_deal_id;
  -- Capture's existing settled trigger updates the same profiles. Lock in the
  -- established listing -> profiles -> deal -> payment order before it runs.
  PERFORM id FROM public.profiles WHERE id IN (d.buyer_id,d.seller_id) ORDER BY id FOR UPDATE;
  SELECT * INTO d FROM public.lock_ins WHERE id=p_deal_id FOR UPDATE;
  SELECT * INTO p FROM public.deal_payments WHERE deal_id=p_deal_id FOR UPDATE;
  IF NOT FOUND OR p.lease_token IS DISTINCT FROM p_lease_token OR p.lease_until<=clock_timestamp() THEN
    RAISE EXCEPTION 'payment lease lost'; END IF;
  target := p_result->>'status'; provider := p_result->>'provider_status';
  IF p_result ? 'authorization_expires_at' THEN expiry := (p_result->>'authorization_expires_at')::timestamptz; END IF;
  IF target IS NULL OR target NOT IN ('approval_required','authorized','captured','cancelled','unknown')
    OR (provider IS NOT NULL AND provider !~ '^[A-Z_]{1,40}$') THEN RAISE EXCEPTION 'invalid result'; END IF;
  IF p.pending_operation='capture' AND target IN ('approval_required','authorized') THEN
    RAISE EXCEPTION 'capture outcome requires capture or verified cancellation evidence'; END IF;
  IF target='authorized' AND (p.authorization_id IS NULL OR p.order_id IS NULL OR p.authorize_requested_at IS NULL
    OR p.pending_operation='capture' OR provider IS DISTINCT FROM 'CREATED'
    OR expiry IS NULL OR NOT isfinite(expiry) OR expiry<=clock_timestamp()) THEN
    RAISE EXCEPTION 'verified authorization required'; END IF;
  IF target='captured' AND (p.capture_id IS NULL OR p.authorization_id IS NULL OR p.order_id IS NULL
    OR p.buyer_handoff_at IS NULL OR p.seller_handoff_at IS NULL OR p.capture_requested_at IS NULL
    OR provider IS DISTINCT FROM 'COMPLETED') THEN RAISE EXCEPTION 'verified capture and human handoffs required'; END IF;
  IF target='cancelled' AND (p.capture_id IS NOT NULL OR
    (p.authorization_id IS NOT NULL AND (provider IS NULL OR provider NOT IN ('VOIDED','EXPIRED','DENIED')))) THEN
    RAISE EXCEPTION 'verified uncaptured cancellation required'; END IF;
  IF target='approval_required' AND p.order_id IS NULL THEN RAISE EXCEPTION 'order required'; END IF;
  IF p_result ? 'approval_url' AND (p_result->>'approval_url') !~ '^https://www[.]sandbox[.]paypal[.]com/[^[:space:]]+$' THEN
    RAISE EXCEPTION 'invalid approval URL'; END IF;
  UPDATE public.deal_payments SET status=target,provider_status=coalesce(provider,provider_status),
    approval_url=coalesce(p_result->>'approval_url',approval_url),
    authorization_expires_at=coalesce(expiry,authorization_expires_at),
    authorized_at=CASE WHEN target='authorized' THEN coalesce(authorized_at,clock_timestamp()) ELSE authorized_at END,
    expires_at=CASE WHEN target='authorized' AND authorized_at IS NULL AND expires_at>clock_timestamp()
      THEN least(clock_timestamp()+interval '24 hours',expiry)
      WHEN target='authorized' THEN least(expires_at,expiry) ELSE expires_at END,
    last_error=CASE WHEN target='unknown' THEN 'reconciliation_required' ELSE NULL END,
    pending_operation=CASE WHEN target='unknown' THEN pending_operation ELSE NULL END,
    operation_started_at=CASE WHEN target='unknown' THEN operation_started_at ELSE NULL END,
    lease_token=NULL,lease_until=NULL,lease_action=NULL,
    next_reconcile_at=CASE WHEN target='unknown' THEN clock_timestamp()+interval '1 minute' ELSE NULL END,
    updated_at=now() WHERE deal_id=p_deal_id;
  -- The existing settled trigger performs listing unlock/sold and counts.
  -- No deal payment claim is ever mapped to the legacy paid state.
  IF target='captured' THEN
    UPDATE public.lock_ins SET state='confirmed',paid_at=coalesce(paid_at,now()),confirmed_at=coalesce(confirmed_at,now())
      WHERE id=d.id AND state='pending_payment';
  ELSIF target='cancelled' THEN
    UPDATE public.lock_ins SET state='cancelled',cancelled_at=now(),cancelled_by=p.cancelled_by,cancelled_from=state
      WHERE id=d.id AND state='pending_payment';
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION public.due_deal_payments(p_limit integer DEFAULT 10)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT deal_id FROM public.deal_payments WHERE auth.role()='service_role'
    AND status NOT IN ('captured','cancelled') AND (lease_until IS NULL OR lease_until<=clock_timestamp())
    AND (expires_at<=clock_timestamp() OR authorization_expires_at<=clock_timestamp() OR (pending_operation IS NOT NULL
      AND (next_reconcile_at IS NULL OR next_reconcile_at<=clock_timestamp())))
    ORDER BY coalesce(next_reconcile_at,expires_at),deal_id LIMIT greatest(1,least(p_limit,20));
$$;

CREATE FUNCTION public.guard_sandbox_deal_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.deal_payments;
BEGIN
  SELECT * INTO p FROM public.deal_payments WHERE deal_id=old.id FOR UPDATE;
  IF NOT FOUND THEN RETURN new; END IF;
  IF (new.listing_id,new.buyer_id,new.seller_id,new.locked_price_cents) IS DISTINCT FROM
    (old.listing_id,old.buyer_id,old.seller_id,old.locked_price_cents) THEN
    RAISE EXCEPTION 'sandbox payment association is immutable'; END IF;
  IF new.state IS DISTINCT FROM old.state AND NOT
    ((new.state='confirmed' AND p.status='captured') OR (new.state='cancelled' AND p.status='cancelled')) THEN
    RAISE EXCEPTION 'use verified sandbox payment actions for this deal'; END IF;
  RETURN new;
END;
$$;
CREATE TRIGGER guard_sandbox_deal BEFORE UPDATE ON public.lock_ins
  FOR EACH ROW EXECUTE FUNCTION public.guard_sandbox_deal_transition();

-- Transactional notification rows reuse the existing private outbox/drain.
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_kind;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_kind CHECK (kind IN ('offer_received','deal_payment'));
ALTER TABLE public.email_outbox ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX email_outbox_dedupe ON public.email_outbox(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE FUNCTION public.enqueue_deal_payment_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE event text; recipient uuid; mail text; title text; lid uuid; suffix text;
BEGIN
  IF TG_OP='INSERT' THEN RETURN new; END IF;
  IF new.status IS DISTINCT FROM old.status THEN
    event:=CASE new.status WHEN 'approval_required' THEN 'approval_required' WHEN 'authorized' THEN 'authorized'
      WHEN 'captured' THEN 'captured' WHEN 'cancelled' THEN 'cancelled' WHEN 'unknown' THEN 'reconciliation_required' END;
    suffix:=event;
  ELSIF new.buyer_handoff_at IS DISTINCT FROM old.buyer_handoff_at THEN event:='handoff_confirmed';suffix:='buyer_handoff';
  ELSIF new.seller_handoff_at IS DISTINCT FROM old.seller_handoff_at THEN event:='handoff_confirmed';suffix:='seller_handoff';
  END IF;
  IF event IS NULL THEN RETURN new; END IF;
  SELECT l.title,l.id INTO title,lid FROM public.listings l JOIN public.lock_ins d ON d.listing_id=l.id WHERE d.id=new.deal_id;
  FOREACH recipient IN ARRAY ARRAY[new.buyer_id,new.seller_id] LOOP
    SELECT email INTO mail FROM auth.users WHERE id=recipient AND email_confirmed_at IS NOT NULL;
    IF mail IS NOT NULL THEN
      INSERT INTO public.email_outbox(kind,to_email,to_profile,listing_id,payload,send_after,dedupe_key)
        VALUES('deal_payment',mail,recipient,lid,jsonb_build_object('deal_id',new.deal_id,'listing_title',title,
          'event',event,'amount_cents',new.amount_cents,'currency','USD'),now(),new.deal_id::text||':'||suffix||':'||recipient::text)
        ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    END IF;
  END LOOP;
  RETURN new;
END;
$$;
CREATE TRIGGER deal_payment_email AFTER INSERT OR UPDATE ON public.deal_payments
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_deal_payment_email();

-- Payment lifecycle events are not collapsed with other events on a listing.
CREATE OR REPLACE FUNCTION public.claim_email_batch(p_limit int DEFAULT 20)
RETURNS TABLE(id uuid,kind text,to_email text,to_profile uuid,listing_id uuid,payload jsonb,collapsed int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY WITH due AS (
    SELECT o.id,o.kind,o.to_email,o.to_profile,o.listing_id,o.payload,o.created_at
    FROM public.email_outbox o WHERE o.sent_at IS NULL AND o.attempts<5 AND o.send_after<=now()
      AND (o.claimed_at IS NULL OR o.claimed_at<now()-interval '5 minutes')
    ORDER BY o.send_after,o.id LIMIT greatest(p_limit,1) FOR UPDATE SKIP LOCKED
  ), grouped AS (
    SELECT d.to_email,d.kind,d.listing_id,
      (array_agg(d.id ORDER BY d.created_at DESC,d.id DESC))[1] keep_id,count(*)::int collapsed
    FROM due d GROUP BY d.to_email,d.kind,d.listing_id,CASE WHEN d.kind='deal_payment' THEN d.id ELSE NULL END
  ), claimed AS (
    UPDATE public.email_outbox o SET claimed_at=now(),attempts=o.attempts+1
      WHERE o.id IN (SELECT g.keep_id FROM grouped g) RETURNING o.id
  ), superseded AS (
    UPDATE public.email_outbox o SET sent_at=now(),last_error='collapsed'
      WHERE o.id IN (SELECT d.id FROM due d) AND o.id NOT IN (SELECT g.keep_id FROM grouped g) RETURNING o.id
  ) SELECT o.id,o.kind,o.to_email,o.to_profile,o.listing_id,o.payload,g.collapsed
    FROM grouped g JOIN public.email_outbox o ON o.id=g.keep_id
    WHERE (SELECT count(*) FROM claimed)>=0 AND (SELECT count(*) FROM superseded)>=0;
END;
$$;

REVOKE ALL ON FUNCTION public._payment_public(public.deal_payments,boolean),public.guard_sandbox_deal_transition(),
  public.enqueue_deal_payment_email() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_deal_payment(uuid),public.confirm_deal_payment_handoff(uuid,boolean)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_deal_payment(uuid),public.confirm_deal_payment_handoff(uuid,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_deal_payment(uuid,uuid,text,uuid,text,text),
  public.record_deal_payment_resource(uuid,uuid,text,text),public.finish_deal_payment(uuid,uuid,jsonb),
  public.due_deal_payments(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_deal_payment(uuid,uuid,text,uuid,text,text),
  public.record_deal_payment_resource(uuid,uuid,text,text),public.finish_deal_payment(uuid,uuid,jsonb),
  public.due_deal_payments(integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
