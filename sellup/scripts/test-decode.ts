/**
 * End-to-end check of the registry's identity rule, using real QR images.
 * Run with: bun run test:decode   (after `bun run qrs`)
 *
 * Decodes each PNG with the same jsQR the web upload path uses, then applies
 * the same normalisation and sha256. Proves the property the product rests on:
 * a forwarded ticket produces the SAME hash as the original, so the unique
 * index catches it -- while a genuinely different ticket does not.
 *
 * The browser path differs only in how pixels are obtained (canvas vs pngjs).
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { createHash } from 'node:crypto';
import { normalisePayload } from '../services/normalise';

function decode(path: string): string {
  const png = PNG.sync.read(readFileSync(path));
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height, {
    inversionAttempts: 'attemptBoth',
  });
  if (!result) throw new Error(`No QR found in ${path}`);
  return result.data;
}

/** Mirrors hashPayload() -- expo-crypto uses SHA-256 over the same input. */
const hash = (raw: string) =>
  createHash('sha256').update(normalisePayload(raw)).digest('hex');

let failures = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const A = decode('test-qr/ticket-A.png');
const AF = decode('test-qr/ticket-A-forwarded.png');
const B = decode('test-qr/ticket-B.png');

console.log('decoded payloads:');
console.log(`  A         ${A}`);
console.log(`  A-fwd     ${AF}`);
console.log(`  B         ${B}\n`);

check(A !== AF, 'the forwarded QR encodes a DIFFERENT string than the original');
check(hash(A) === hash(AF), 'yet both hash IDENTICALLY -> registry catches the duplicate');
check(hash(A) !== hash(B), 'a genuinely different ticket hashes differently -> not a false positive');
check(/^[0-9a-f]{64}$/.test(hash(A)), 'hash is a sha256 hex digest');
check(!hash(A).includes('ABC123XYZ'), 'the raw code is not recoverable from what we store');

console.log(`\n  hash(A)     ${hash(A)}`);
console.log(`  hash(A-fwd) ${hash(AF)}`);
console.log(`  hash(B)     ${hash(B)}`);

console.log(failures === 0 ? '\nAll decode tests passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
