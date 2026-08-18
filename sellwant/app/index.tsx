/**
 * The front door is the shop window.
 *
 * `/` used to be the sign-in screen, which meant sellwant.com greeted every
 * first-time visitor with a password box -- the exact wall the public feed was
 * built to remove. Someone who has never heard of us should land in the
 * marketplace and find out what it is.
 *
 * Re-exported rather than redirected on purpose: a redirect costs a frame of
 * spinner and a history entry, and `/` is the URL people type and paste.
 * Signing in now lives at /signin, which is only reached deliberately.
 */
export { default } from './feed';
