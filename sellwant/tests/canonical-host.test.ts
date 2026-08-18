import { describe, expect, test } from 'bun:test';
import { canonicalTarget } from '../worker/index.js';

/**
 * `wrangler dev` serves every route under the first configured hostname, so a
 * local HTTP request can never actually arrive as www. These cover the
 * decision itself, which is the part that can be wrong.
 */
describe('canonicalTarget', () => {
  test('sends www to the apex, keeping the whole URL', () => {
    expect(canonicalTarget('https://www.sellwant.com/')).toBe('https://sellwant.com/');
    expect(canonicalTarget('https://www.sellwant.com/feed')).toBe('https://sellwant.com/feed');
    // A shared listing has to survive the hop, or the redirect loses the thing
    // the person actually clicked.
    expect(canonicalTarget('https://www.sellwant.com/event/abc?x=1#y')).toBe(
      'https://sellwant.com/event/abc?x=1#y'
    );
  });

  test('leaves the apex alone', () => {
    expect(canonicalTarget('https://sellwant.com/')).toBeNull();
    expect(canonicalTarget('https://sellwant.com/event/abc')).toBeNull();
  });

  test('does not touch other hosts', () => {
    // A workers.dev preview must keep working, and a lookalike host must not
    // be treated as ours.
    expect(canonicalTarget('https://sellwant.luquibotbol.workers.dev/feed')).toBeNull();
    expect(canonicalTarget('https://www.sellwant.com.evil.example/')).toBeNull();
    expect(canonicalTarget('https://notwww.sellwant.com/')).toBeNull();
  });
});
