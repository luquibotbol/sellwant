/** Review values are parsed exactly; the database remains the authority. */
export function mandateBoundCents(value: string): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error('Enter a USD amount with at most two decimal places.');
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 2147483647) {
    throw new Error('Enter an amount from $0.01 to $21,474,836.47.');
  }
  return cents;
}

export function mandatePositiveInteger(value: string, maximum: number, label: string): number {
  if (!/^[1-9]\d*$/.test(value.trim())) throw new Error(`${label} must be a whole number.`);
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new Error(`${label} must be between 1 and ${maximum}.`);
  return parsed;
}

export const AGENT_CAPABILITY_TOOLS = [
  { id: 'get_mandate', label: 'Read mandate', description: 'View this mandate’s limits and status.' },
  { id: 'get_deal', label: 'Read deal', description: 'View its locked deal and agreed price.' },
  { id: 'place_offer', label: 'Place offers', description: 'Post public offers within the approved limit.' },
  { id: 'accept_offer', label: 'Accept offers', description: 'Lock one deal within the approved limit.' },
  { id: 'revoke_mandate', label: 'Revoke mandate', description: 'Stop future agent trading for this mandate.' },
] as const;
export type AgentCapabilityTool = typeof AGENT_CAPABILITY_TOOLS[number]['id'];
