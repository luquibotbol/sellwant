import type { AgentAiEnv, AgentTerms, NegotiationProposal, PublicAgentOffer } from '../worker/ai';
import type { MarketListing } from '../worker/market';
export const ids = {
  listing: '11111111-1111-4111-8111-111111111111', mandate: '22222222-2222-4222-8222-222222222222',
  offer: '33333333-3333-4333-8333-333333333333', own: '44444444-4444-4444-8444-444444444444',
  counter: '55555555-5555-4555-8555-555555555555', watch: '66666666-6666-4666-8666-666666666666',
  capability: '77777777-7777-4777-8777-777777777777', lease: '88888888-8888-4888-8888-888888888888',
  receipt: '99999999-9999-4999-8999-999999999999', deal: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};
export const token = `swcap_${'a'.repeat(64)}`;
export const env: AgentAiEnv = { AGENT_AI_ENABLED: 'true', AGENT_WATCHER_ENABLED: 'true',
  AGENT_AI_ORIGIN: 'http://127.0.0.1:55330', AGENT_MCP_ORIGIN: 'http://127.0.0.1:55330',
  SUPABASE_URL: 'http://127.0.0.1:55321', SUPABASE_ANON_KEY: 'sb_publishable_synthetic',
  SUPABASE_SECRET_KEY: 'sb_secret_synthetic', OPENAI_API_KEY: 'synthetic-test-key',
  AGENT_WATCHER_ENCRYPTION_KEY: btoa('a'.repeat(32)) };
export const listing: MarketListing = { id: ids.listing, url: `${env.AGENT_AI_ORIGIN}/event/${ids.listing}`,
  title: 'Synthetic concert', type: 'sell', price_cents: 2000, currency: 'USD',
  going_rate_cents: 1665, going_rate_status: 'available', offers: 1, event_date: null, location: 'Test hall' };
export const terms: AgentTerms = { id: ids.mandate, listing_id: ids.listing, side: 'sell', bound_cents: 1600,
  currency: 'USD', status: 'approved', expires_at: new Date(Date.now() + 3600000).toISOString(),
  max_rounds: 4, rounds_used: 0, is_poster: true };
export const offers: PublicAgentOffer[] = [{ id: ids.offer, listing_id: ids.listing, parent_offer_id: null,
  amount_cents: 1665, is_poster: false, message: 'Synthetic offer', created_at: '2026-11-05T12:00:00Z' }];
export const place: NegotiationProposal = { action: 'place_offer', amount_cents: 1700,
  offer_id: null, parent_offer_id: ids.offer, message: 'Can you meet at this price?', explanation: 'This counter remains above the approved minimum.' };
export const wait: NegotiationProposal = { action: 'wait', amount_cents: null, offer_id: null,
  parent_offer_id: null, message: null, explanation: 'Waiting for an opposing response.' };
export function modelResponse(proposal: unknown) {
  return Response.json({ id: 'resp_synthetic', model: 'gpt-5.4-mini-test', status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }] });
}
