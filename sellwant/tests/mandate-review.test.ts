import { describe, expect, test } from 'bun:test';
import { mandateBoundCents, mandatePositiveInteger } from '../lib/mandates';

describe('mandate review amounts', () => {
  test('keeps decimal dollars exact, including one-cent boundaries', () => {
    expect(mandateBoundCents('17.99')).toBe(1799);
    expect(mandateBoundCents('18')).toBe(1800);
    expect(mandateBoundCents('18.01')).toBe(1801);
    expect(mandateBoundCents(' 16.65 ')).toBe(1665);
    expect(mandateBoundCents('0.1')).toBe(10);
    expect(mandateBoundCents('21474836.47')).toBe(2147483647);
  });

  test('never silently rounds or accepts partial numeric input', () => {
    for (const value of ['', '0', '0.00', '-1', '+18', '018', '.50', '18.', '18.001', '18 dollars', '1,000', '1e2', 'NaN', 'Infinity', '21474836.48', '9999999999999999999']) {
      expect(() => mandateBoundCents(value)).toThrow();
    }
  });

  test('expiry and round inputs cannot become fractional or unbounded', () => {
    expect(mandatePositiveInteger('4', 20, 'Rounds')).toBe(4);
    for (const value of ['0', '-1', '1.5', '2abc', '1e1', '21', '99999999999999999999']) {
      expect(() => mandatePositiveInteger(value, 20, 'Rounds')).toThrow();
    }
  });
});
