import { describe, expect, test } from 'bun:test';

/**
 * jsQR is loaded on demand, and that is a performance decision the type
 * checker cannot protect.
 *
 * It is 127 KB of the web bundle and it is needed only once somebody has
 * picked an image, so `services/qr.ts` imports it inside the decode function
 * rather than at the top of the file. Two things can quietly undo that: the
 * package failing to resolve as an ES module, which would surface as a runtime
 * error the moment a real person uploads a ticket, and somebody moving the
 * import back to the top during an unrelated edit, which costs everyone the
 * download again with nothing failing to say so.
 */
describe('jsQR stays a lazy import', () => {
  test('resolves as an ES module with a callable default', async () => {
    const mod = await import('jsqr');
    expect(typeof mod.default).toBe('function');
  });

  test('services/qr.ts does not import it at module scope', async () => {
    const source = await Bun.file(
      new URL('../services/qr.ts', import.meta.url)
    ).text();

    // A top-level `import ... from 'jsqr'` is the regression this guards.
    const topLevel = /^\s*import[^\n]*from\s+['"]jsqr['"]/m.test(source);
    expect(topLevel).toBe(false);

    // And the dynamic form is still there, so the check cannot pass by the
    // decoder having been deleted altogether.
    expect(source).toContain("await import('jsqr')");
  });
});
