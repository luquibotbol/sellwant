import { afterEach, describe, expect, test } from 'bun:test';
import {
  AgentFailure, agentConfiguration, agentJson, handleAgentAi, proposeMandate, proposeNegotiation,
  publicAgentText, validateNegotiation, type AgentTransport,
} from '../worker/ai';
import { env, ids, listing, modelResponse, offers, place, terms, token, wait } from './ai-fixtures';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const ready = { status: 'ready', bound_cents: 1600, duration_minutes: 60, max_rounds: 4, explanation: 'Explicit minimum and duration.', clarification: null };
const transport = (response: Response): AgentTransport => (async () => response) as unknown as AgentTransport;

describe('structured AI proposal boundary (fixture provider)', () => {
  test('strict Responses request has no tools, persistent store or authority', async () => {
    let request: Record<string, any> | null = null;
    await proposeMandate(env, { instruction: 'Sell for at least $16 for one hour.', side: 'sell', listing },
      (async (url, init) => { expect(url).toBe('https://api.openai.com/v1/responses'); request = JSON.parse(String(init?.body)); return modelResponse(ready); }) as AgentTransport);
    const sent = request as unknown as Record<string, any>;
    expect(sent.model).toBe('gpt-5.4-mini'); expect(sent.store).toBe(false); expect(sent.tools).toBeUndefined();
    expect(sent.text.format.strict).toBe(true); expect(sent.text.format.schema.additionalProperties).toBe(false);
    expect(sent.text.format.schema.required.sort()).toEqual(Object.keys(ready).sort());
    expect(sent.instructions).toContain('untrusted DATA'); expect(sent.instructions).toContain('Never approve/create mandates');
  });
  test('clarification never becomes an invented ready mandate', async () => {
    const clarification = { ...ready, status: 'needs_clarification', bound_cents: null, clarification: 'What is your exact minimum?' };
    expect((await proposeMandate(env, { instruction: 'Sell this ticket.', side: 'sell', listing }, transport(modelResponse(clarification)))).proposal.status).toBe('needs_clarification');
    await expect(proposeMandate(env, { instruction: 'Sell this ticket.', side: 'sell', listing }, transport(modelResponse({ ...ready, bound_cents: null })))).rejects.toMatchObject({ code: 'invalid_proposal' });
  });
  test('rejects model-invented authority fields, fractional cents and extra IDs', async () => {
    for (const proposal of [{ ...ready, approved: true }, { ...ready, bound_cents: 1600.5 }, { ...ready, payment_authorized: true }]) {
      await expect(proposeMandate(env, { instruction: 'Minimum $16.', side: 'sell', listing }, transport(modelResponse(proposal)))).rejects.toMatchObject({ code: 'invalid_proposal' });
    }
    await expect(proposeNegotiation(env, { terms, listing, offers, own_offer_ids: [], offers_complete: true }, transport(modelResponse({ ...place, amount_cents: 1599 })))).rejects.toMatchObject({ code: 'invalid_proposal' });
  });
  test('only public listing and offer fields reach the model', async () => {
    let sent = '';
    const maliciousListing = { ...listing, location: 'contact-private@example.edu', ticket_qr: 'PRIVATE_QR_PAYLOAD',
      description: 'PRIVATE_DESCRIPTION', seller_contact: 'PRIVATE_CONTACT', completed_price_cents: 9876543 };
    const maliciousOffer = { ...offers[0], private_contact: 'PRIVATE_CONTACT', message: token };
    await proposeNegotiation(env, { terms, listing: maliciousListing, offers: [maliciousOffer], own_offer_ids: [], offers_complete: true },
      (async (_url, init) => { sent = String(init?.body); return modelResponse(wait); }) as AgentTransport);
    for (const privateValue of ['PRIVATE_QR_PAYLOAD', 'PRIVATE_DESCRIPTION', 'PRIVATE_CONTACT', '9876543', token, 'contact-private@example.edu']) expect(sent).not.toContain(privateValue);
    expect(sent).toContain('sensitive marketplace text omitted'); expect(sent).toContain('bound_cents');
  });
  test('human prompt rejects contacts, URLs, capability and encoded ticket payloads before provider call', async () => {
    let called = 0;
    for (const instruction of [token, 'Contact me at somebody@example.edu', 'https://ticket.test/rawqr', 'a'.repeat(80), '+1 (212) 555-0100']) {
      await expect(proposeMandate(env, { instruction, side: 'sell', listing }, (async () => { called++; return modelResponse(ready); }) as unknown as AgentTransport)).rejects.toMatchObject({ code: 'invalid_input' });
    }
    expect(called).toBe(0); expect(publicAgentText('ordinary event text', 100)).toBe('ordinary event text');
  });
  test('formatted money and equivalent cents in explanations are not mistaken for phone numbers', async () => {
    const formatted = { ...ready, explanation: 'Minimum $16.00 (1600 cents), 60 minutes and four rounds.' };
    expect((await proposeMandate(env, { instruction: 'Minimum $16.00 (1600 cents).', side: 'sell', listing }, transport(modelResponse(formatted)))).proposal.explanation).toBe(formatted.explanation);
    for (const contact of ['+1 (212) 555-0100', '212-555-0100', '2125550100', '+12125550100']) {
      expect(publicAgentText(contact, 100)).toBe('[sensitive marketplace text omitted]');
    }
  });
  test('refusal, incomplete and malformed response fail closed', async () => {
    const result = (body: unknown) => proposeMandate(env, { instruction: 'Minimum $16.', side: 'sell', listing }, transport(Response.json(body)));
    await expect(result({ id: 'resp', model: 'gpt-5.4-mini', status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] })).rejects.toMatchObject({ code: 'model_refused' });
    await expect(result({ id: 'resp', model: 'gpt-5.4-mini', status: 'incomplete', output: [] })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(result({ id: 'resp', model: 'gpt-5.4-mini', status: 'completed', output: [] })).rejects.toMatchObject({ code: 'invalid_proposal' });
  });
  test('quota diagnostic retains safe status/code/request ID without provider text or secrets', async () => {
    try {
      await proposeMandate(env, { instruction: 'Minimum $16.', side: 'sell', listing }, transport(Response.json({ error: {
        code: 'credit_balance_exhausted', type: 'insufficient_quota', message: `secret ${token}`,
      } }, { status: 429, headers: { 'x-request-id': 'req_synthetic1234' } })));
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentFailure); expect((error as AgentFailure).code).toBe('account_required');
      expect((error as AgentFailure).diagnostic).toEqual({ stage: 'http_rejection', http_status: 429,
        request_id: 'req_synthetic1234', error_code: 'credit_balance_exhausted', error_type: 'insufficient_quota' });
      expect(JSON.stringify(error)).not.toContain(token);
    }
  });
  test('unknown provider diagnostic strings are never reflected', async () => {
    await expect(proposeMandate(env, { instruction: 'Minimum $16.', side: 'sell', listing }, transport(Response.json({ error: { code: token, type: env.OPENAI_API_KEY } }, { status: 400,
      headers: { 'x-request-id': token } })))).rejects.toMatchObject({ diagnostic: { request_id: null,
        error_code: 'other_provider_error', error_type: 'other_provider_error' } });
  });
  test('bounded parser cancels oversized and non-JSON responses', async () => {
    await expect(agentJson(Response.json({ padding: 'x'.repeat(5000) }), 100)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(agentJson(new Response('{}', { headers: { 'content-type': 'text/plain' } }))).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('deterministic validation of generated trade suggestions', () => {
  test('seller counter and exact acceptance obey minimum and opponent role', () => {
    expect(() => validateNegotiation(place, { terms, offers, own_offer_ids: [] })).not.toThrow();
    expect(() => validateNegotiation({ ...place, parent_offer_id: null }, { terms, offers, own_offer_ids: [] })).toThrow();
    expect(() => validateNegotiation({ ...wait, action: 'accept_offer', offer_id: ids.offer }, { terms, offers, own_offer_ids: [] })).not.toThrow();
    expect(() => validateNegotiation({ ...wait, action: 'accept_offer', offer_id: ids.offer, amount_cents: 1665 }, { terms, offers, own_offer_ids: [] })).toThrow();
    expect(() => validateNegotiation({ ...wait, action: 'accept_offer', offer_id: ids.offer }, { terms, offers, own_offer_ids: [ids.offer] })).toThrow();
  });
  test('buyer accepts only a poster counter addressed to their own persisted offer', () => {
    const buyer = { ...terms, side: 'buy' as const, bound_cents: 1800, is_poster: false };
    const counter = { ...offers[0], id: ids.counter, is_poster: true, parent_offer_id: ids.own };
    const accept = { ...wait, action: 'accept_offer' as const, offer_id: ids.counter };
    expect(() => validateNegotiation(accept, { terms: buyer, offers: [counter], own_offer_ids: [ids.own] })).not.toThrow();
    expect(() => validateNegotiation(accept, { terms: buyer, offers: [counter], own_offer_ids: [] })).toThrow();
    expect(() => validateNegotiation({ ...place, amount_cents: 1801, parent_offer_id: null }, { terms: buyer, offers: [], own_offer_ids: [] })).toThrow();
  });
  test('expired, consumed, exhausted mandates and malformed wait proposals reject', () => {
    for (const changed of [{ ...terms, expires_at: '2000-01-01T00:00:00Z' }, { ...terms, status: 'consumed' }, { ...terms, rounds_used: terms.max_rounds }]) {
      expect(() => validateNegotiation(wait, { terms: changed, offers, own_offer_ids: [] })).toThrow();
    }
    expect(() => validateNegotiation({ ...wait, message: 'post this' }, { terms, offers, own_offer_ids: [] })).toThrow();
  });
});

describe('human AI HTTP authority', () => {
  const request = (payload: unknown, headers: Record<string, string> = {}) => new Request(`${env.AGENT_AI_ORIGIN}/api/agent/watch`, {
    method: 'POST', headers: { origin: env.AGENT_AI_ORIGIN!, authorization: `Bearer ${'a'.repeat(30)}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload),
  });
  test('disabled and cross-origin APIs never reach auth/provider/DB', async () => {
    let called = 0; globalThis.fetch = (async () => { called++; throw new Error(); }) as unknown as AgentTransport;
    expect((await handleAgentAi(request({}), { ...env, AGENT_AI_ENABLED: 'false' }))?.status).toBe(404);
    expect((await handleAgentAi(request({}, { origin: 'https://evil.invalid' }), env))?.status).toBe(403);
    expect((await handleAgentAi(request({}, { host: 'evil.invalid' }), env))?.status).toBe(403); expect(called).toBe(0);
  });
  test('capability bearer cannot call human endpoints', async () => {
    let called = 0; globalThis.fetch = (async () => { called++; throw new Error(); }) as unknown as AgentTransport;
    expect((await handleAgentAi(request({}, { authorization: `Bearer ${token}` }), env))?.status).toBe(403); expect(called).toBe(0);
  });
  test('human JWT must verify at auth server before any enrollment', async () => {
    const urls: string[] = []; globalThis.fetch = (async url => { urls.push(String(url)); return Response.json({ error: 'invalid' }, { status: 401 }); }) as AgentTransport;
    expect((await handleAgentAi(request({ action: 'stop', watch_id: ids.watch }), env))?.status).toBe(403);
    expect(urls).toEqual([`${env.SUPABASE_URL}/auth/v1/user`]);
  });
  test('watch expiry must exactly equal the verified dedicated capability expiry', async () => {
    const urls: string[] = []; globalThis.fetch = (async url => {
      urls.push(String(url)); if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: ids.capability });
      if (String(url).endsWith('/agent_get_access')) return Response.json({ id: ids.capability, mandate_id: ids.mandate, expires_at: new Date(Date.now() + 3600000).toISOString() });
      throw new Error('No mutation should occur');
    }) as AgentTransport;
    const response = await handleAgentAi(request({ action: 'start', mandate_id: ids.mandate, capability: token,
      enrollment_key: ids.lease, expires_at: new Date(Date.now() + 600000).toISOString() }), env);
    expect(response?.status).toBe(403); expect(urls.some(u => u.includes('start_agent_watch'))).toBe(false);
  });
  test('known production origin/database and privileged discovery keys reject', () => {
    expect(() => agentConfiguration({ ...env, AGENT_AI_ORIGIN: 'https://sellwant.com' })).toThrow();
    expect(() => agentConfiguration({ ...env, SUPABASE_URL: 'https://gguzeafbwsqkhggmcjjl.supabase.co' })).toThrow();
    expect(() => agentConfiguration({ ...env, SUPABASE_ANON_KEY: 'sb_secret_synthetic' })).toThrow();
  });
});
