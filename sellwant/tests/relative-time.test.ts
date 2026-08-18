import { describe, expect, test } from 'bun:test';
import { relativeTime } from '../lib/format';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/**
 * The admin dashboard rendered "Updated Tomorrow" because it used
 * relativeDate, which is for event dates and points forwards. These pin the
 * direction and the vocabulary.
 */
describe('relativeTime', () => {
  test('recent things read as just now', () => {
    expect(relativeTime(ago(5_000))).toBe('just now');
  });

  test('minutes and hours', () => {
    expect(relativeTime(ago(5 * 60_000))).toBe('5m ago');
    expect(relativeTime(ago(3 * 3_600_000))).toBe('3h ago');
  });

  test('days, up to a week', () => {
    expect(relativeTime(ago(2 * 86_400_000))).toBe('2d ago');
  });

  test('older than a week falls back to a date', () => {
    expect(relativeTime(ago(30 * 86_400_000))).toMatch(/\w{3} \d+/);
  });

  test('never points into the future', () => {
    // Clock skew between the database and the browser must not produce
    // "Tomorrow" for something that already happened.
    expect(relativeTime(new Date(Date.now() + 60_000).toISOString())).toBe('just now');
  });

  test('a malformed value renders nothing rather than Invalid Date', () => {
    expect(relativeTime('not a date')).toBe('');
  });
});
