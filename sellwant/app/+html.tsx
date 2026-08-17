import React from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';
import { colors } from '@/constants/theme';

/**
 * The web document shell. Native ignores this file.
 *
 * Without it, Expo's default HTML leaves html/body unstyled, so iOS Safari
 * paints white behind the safe areas and tints its own toolbars white -- which
 * is why the app looked like a dark page floating in a white frame.
 */
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover lets the background reach under the notch and
            home indicator. Zoom is NOT disabled here -- the auto-zoom people
            actually hit is fixed properly by using 16px inputs on web. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        {/* Tints Safari's chrome to match the app instead of white. */}
        <meta name="theme-color" content={colors.background} />
        <meta name="color-scheme" content="dark" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="SellWant" />
        <title>SellWant</title>

        {/* Explicit sizes rather than one scaled file: a 64px mark squeezed
            into a 16px tab strip loses its counters. Each of these is drawn
            with its own optical sizing. Served from public/, so the paths are
            root-absolute and survive any route depth. */}
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />

        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: shell }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const shell = `
  html, body, #root {
    background-color: ${colors.background};
    color-scheme: dark;
  }
  body {
    /* Stops the rubber-band overscroll revealing white above and below. */
    overscroll-behavior: none;
    -webkit-tap-highlight-color: transparent;
  }
  /* Keep the dark background under the home indicator and notch. */
  @supports (padding: env(safe-area-inset-top)) {
    body { background-color: ${colors.background}; }
  }
  ::selection { background: ${colors.muted}; }
`;
