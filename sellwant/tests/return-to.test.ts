import { describe, expect, test } from 'bun:test';
import { safeReturnTo } from '../lib/return-to';

describe('safeReturnTo', () => {
  test('keeps internal paths', () => {
    expect(safeReturnTo('/feed')).toBe('/feed');
    expect(safeReturnTo('/event/abc-123')).toBe('/event/abc-123');
    expect(safeReturnTo('/u/xyz?tab=listings')).toBe('/u/xyz?tab=listings');
  });

  test('refuses anything that could leave the site', () => {
    // Each of these has been a real open-redirect bypass somewhere.
    for (const evil of [
      'https://evil.example',
      'http://evil.example',
      '//evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      'evil.example',
    ]) {
      expect(safeReturnTo(evil)).toBeNull();
    }
  });

  test('refuses non-strings', () => {
    expect(safeReturnTo(undefined)).toBeNull();
    expect(safeReturnTo(null)).toBeNull();
    expect(safeReturnTo(['/feed'])).toBeNull();
  });
});
