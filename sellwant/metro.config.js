// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * `expo start --host localhost` only changes the URL Expo prints; Metro still
 * binds to 0.0.0.0, so the dev server stays reachable from every device on the
 * network. Setting server.host binds it for real.
 *
 * Opt-in via LOCAL_ONLY=1 so phone testing over the LAN still works by default.
 */
if (process.env.LOCAL_ONLY) {
  config.server = { ...config.server, host: '127.0.0.1' };
}

module.exports = config;
