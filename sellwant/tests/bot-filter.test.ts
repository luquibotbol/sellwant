import { describe, expect, test } from 'bun:test';
import { isAgent } from '../worker/index.js';

/**
 * Which hits count as a person looking at the page.
 *
 * This decides whether the traffic numbers on the dashboard mean anything. Get
 * it wrong in one direction and every link pasted into a group chat inflates a
 * listing's views; get it wrong in the other and real phones stop being
 * counted.
 *
 * The previewers are the ones worth being careful about. A generic /bot/ test
 * passes them straight through -- facebookexternalhit says nothing about being
 * a bot -- and on a product that spreads by being pasted into WhatsApp they are
 * plausibly the most common non-human request there is.
 */
describe('isAgent', () => {
  test('real browsers are people', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    ]) {
      expect(isAgent(ua)).toBe(false);
    }
  });

  test('link previewers are not', () => {
    for (const ua of [
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.23.20.0 A',
      'TelegramBot (like TwitterBot)',
      'Discordbot/2.0 (+https://discordapp.com)',
      'Slackbot-LinkExpanding 1.0',
      'Twitterbot/1.0',
      'LinkedInBot/1.0',
    ]) {
      expect(isAgent(ua)).toBe(true);
    }
  });

  test('crawlers and agents are not', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'GPTBot/1.0',
      'ChatGPT-User/1.0; +https://openai.com/bot',
      'Mozilla/5.0 (compatible; ClaudeBot/1.0)',
      'PerplexityBot/1.0',
      'curl/8.4.0',
      'python-requests/2.31.0',
    ]) {
      expect(isAgent(ua)).toBe(true);
    }
  });

  test('a missing or empty agent is treated as not a person', () => {
    // A browser always sends one. Something that does not is not somebody
    // reading a listing, and counting it would be the cheapest way to inflate.
    expect(isAgent('')).toBe(true);
    expect(isAgent(null)).toBe(true);
    expect(isAgent(undefined)).toBe(true);
  });
});
