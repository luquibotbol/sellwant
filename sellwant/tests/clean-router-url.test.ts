import { describe, expect, test } from 'bun:test';
import { stripRouterKey } from '../lib/clean-router-url';

const BASE = 'https://sellwant.com/feed';

/**
 * The address bar is a product surface here: a listing spreads by someone
 * copying the URL and pasting it into a group chat. These cover the decision,
 * not the patching -- history is the browser's job, and the part that can be
 * wrong is which characters survive.
 */
describe('stripRouterKey', () => {
  test('removes the router key', () => {
    expect(stripRouterKey('https://sellwant.com/event/abc?__EXPO_ROUTER_key=undefined-x9')).toBe(
      '/event/abc'
    );
  });

  test('keeps every other query parameter', () => {
    // returnTo is how signing in sends you back where you were; dropping it
    // would strand people on the feed after a login they only started because
    // they were trying to buy something.
    expect(
      stripRouterKey('https://sellwant.com/signin?returnTo=%2Fevent%2Fabc&__EXPO_ROUTER_key=undefined-x')
    ).toBe('/signin?returnTo=%2Fevent%2Fabc');
  });

  test('keeps the fragment', () => {
    expect(stripRouterKey('https://sellwant.com/terms?__EXPO_ROUTER_key=k#refunds')).toBe(
      '/terms#refunds'
    );
  });

  test('returns URLs without the key untouched', () => {
    // Identity matters: the patched history methods pass this straight through,
    // so rewriting here would rewrite every navigation in the app.
    const clean = 'https://sellwant.com/event/abc?ref=chat';
    expect(stripRouterKey(clean)).toBe(clean);
    expect(stripRouterKey('/event/abc', BASE)).toBe('/event/abc');
  });

  test('handles the relative URLs pushState is allowed to take', () => {
    expect(stripRouterKey('/create-event?__EXPO_ROUTER_key=undefined-q', BASE)).toBe(
      '/create-event'
    );
  });

  test('survives a key with no value, and repeated keys', () => {
    expect(stripRouterKey('/feed?__EXPO_ROUTER_key=', BASE)).toBe('/feed');
    expect(stripRouterKey('/feed?__EXPO_ROUTER_key=a&__EXPO_ROUTER_key=b', BASE)).toBe('/feed');
  });

  test('does not strip a parameter that merely resembles it', () => {
    const url = '/feed?my__EXPO_ROUTER_key=1';
    expect(stripRouterKey(url, BASE)).toBe(url);
  });
});
