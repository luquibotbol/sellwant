/**
 * Generates QR images for manually testing the registry.
 * Run with: bun run qrs
 *
 * The interesting pair is A and A-forwarded: they encode different strings but
 * the same ticket, so the registry must treat the second as a duplicate.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const QRCode = require('qrcode');
import { mkdirSync } from 'node:fs';

const OUT = 'test-qr';
mkdirSync(OUT, { recursive: true });

const codes: { file: string; payload: string; note: string }[] = [
  {
    file: 'ticket-A.png',
    payload: 'https://bubbl.co/t/ABC123XYZ',
    note: 'The original ticket. Upload this first -- it should be accepted.',
  },
  {
    file: 'ticket-A-forwarded.png',
    payload: 'https://bubbl.co/t/ABC123XYZ?utm_source=imessage&fbclid=z9',
    note: 'Same ticket after being forwarded. DIFFERENT string, SAME ticket -- must be rejected as a duplicate.',
  },
  {
    file: 'ticket-B.png',
    payload: 'https://bubbl.co/t/QRS789LMN',
    note: 'A genuinely different ticket. Must be accepted.',
  },
];

async function main() {
  for (const { file, payload, note } of codes) {
    await QRCode.toFile(`${OUT}/${file}`, payload, { width: 512, margin: 2 });
    console.log(`${file}\n  payload: ${payload}\n  ${note}\n`);
  }
  console.log(`Wrote ${codes.length} QR images to sellup/${OUT}/`);
}

main();
