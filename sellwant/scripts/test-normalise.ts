/**
 * Registry normalisation tests. Run with: bun services/../scripts/test-normalise.ts
 *
 * These assert the property the whole duplicate check rests on: two payloads
 * that represent the SAME ticket must normalise identically, and two that
 * represent DIFFERENT tickets must not.
 */
import { normalisePayload, maskCode } from '../services/normalise';

let failures = 0;

function same(label: string, a: string, b: string) {
  const na = normalisePayload(a);
  const nb = normalisePayload(b);
  const ok = na === nb;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  same: ${label}`);
  if (!ok) console.log(`        ${na}\n        ${nb}`);
}

function differ(label: string, a: string, b: string) {
  const ok = normalisePayload(a) !== normalisePayload(b);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  differ: ${label}`);
}

const ORIGINAL = 'https://bubbl.co/t/ABC123XYZ';

// --- the forwarded-ticket cases: these MUST collide -------------------------
same('utm from an iMessage forward', ORIGINAL, `${ORIGINAL}?utm_source=imessage`);
same('multiple tracking params', ORIGINAL, `${ORIGINAL}?utm_source=ig&fbclid=xyz&igshid=9`);
same('reordered params', `${ORIGINAL}?a=1&b=2`, `${ORIGINAL}?b=2&a=1`);
same('trailing slash', ORIGINAL, `${ORIGINAL}/`);
same('host casing', ORIGINAL, 'https://BUBBL.CO/t/ABC123XYZ');
same('surrounding whitespace', ORIGINAL, `  ${ORIGINAL}  `);
same('opaque token whitespace', 'TICKET  ABC   123', 'TICKET ABC 123');

// --- genuinely different tickets: these MUST NOT collide --------------------
differ('different ticket id', ORIGINAL, 'https://bubbl.co/t/DIFFERENT1');
differ('meaningful param retained', `${ORIGINAL}?seat=A1`, `${ORIGINAL}?seat=B2`);
differ('different path', ORIGINAL, 'https://bubbl.co/t/ABC123XYZ/extra');
differ('token case is significant', 'AbC123', 'abc123');
differ('different opaque tokens', 'TICKET-A', 'TICKET-B');

// --- masking must not leak the middle of a code -----------------------------
const masked = maskCode(ORIGINAL);
const maskOk = !masked.includes('ABC123XYZ') && masked.includes('••••');
if (!maskOk) failures++;
console.log(`${maskOk ? 'PASS' : 'FAIL'}  mask hides the code body  (${masked})`);

console.log(failures === 0 ? '\nAll normalisation tests passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
