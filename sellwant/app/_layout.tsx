import React, { useEffect } from 'react';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
// Imported by subpath, NOT from '@expo-google-fonts/geist'. That package's
// index.js has a top-level require() for all 18 weights and italics, so
// importing from the root bundles 1.66 MB of fonts to use four of them.
// Subpath imports pull only what we actually render: 368 KB.
import Geist_400Regular from '@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf';
import Geist_500Medium from '@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf';
import Geist_600SemiBold from '@expo-google-fonts/geist/600SemiBold/Geist_600SemiBold.ttf';
import Geist_700Bold from '@expo-google-fonts/geist/700Bold/Geist_700Bold.ttf';
import { View } from 'react-native';
import Head from 'expo-router/head';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import BottomNav from '@/components/BottomNav';
import { ErrorBoundary } from './error-boundary';
import { trackView } from '@/services/analytics';
import { installUrlCleaner } from '@/lib/clean-router-url';
import { colors, type as typeScale } from '@/constants/theme';

export const unstable_settings = {
  initialRouteName: 'index',
};

SplashScreen.preventAutoHideAsync().catch(() => {});

// At module scope, not in an effect: expo-router can navigate before the first
// effect runs, and a parameter that flashes into the address bar is still one
// somebody can copy.
installUrlCleaner();

/** Scrapers never run our JS, so these are baked into every prerendered page
 *  rather than derived at runtime. Absolute, because relative og:image is
 *  ignored by every major platform. */
const SITE = 'https://sellwant.com';
const BLURB =
  'Buy what you want. Sell what you have. A two-sided marketplace for the ' +
  'tickets your friends are already trading.';

/**
 * One impression per screen.
 *
 * Lives in the root layout because it is the only place that sees every route
 * without each screen having to remember. The effect does no work beyond
 * calling into analytics, which debounces and hands off to sendBeacon -- there
 * is no fetch on this path and nothing here can delay a render.
 */
function useViewTracking() {
  const pathname = usePathname();
  useEffect(() => {
    const listing = pathname.startsWith('/event/') ? pathname.split('/')[2] : undefined;
    trackView(pathname, listing);
  }, [pathname]);
}

export default function RootLayout() {
  useViewTracking();
  // Geist is most of what makes the UI read as Vercel-like, so hold the splash
  // until it resolves rather than flashing a system-font frame.
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  // Render anyway if the font fails -- a missing typeface should degrade to the
  // system stack, not block the app.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        {/* The <title> in +html.tsx loses to an empty one react-helmet injects
            ahead of it, so the tab and every pasted link went untitled. Setting
            it through expo-router's Head puts it in the same helmet queue,
            where it wins. Description drives the group-chat link preview. */}
        <Head>
          <title>SellWant</title>
          <meta name="description" content={BLURB} />

          {/* The whole distribution model is a link pasted into a group chat,
              so the preview card is the product's first impression far more
              often than the site is. og:image must be an absolute URL --
              every scraper rejects a relative one, and it fails silently. */}
          <meta property="og:type" content="website" />
          <meta property="og:site_name" content="SellWant" />
          <meta property="og:title" content="SellWant" />
          <meta property="og:description" content={BLURB} />
          <meta property="og:url" content={`${SITE}/`} />
          <meta property="og:image" content={`${SITE}/og.png`} />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta property="og:image:alt" content="SellWant — buy what you want, sell what you have" />

          {/* Without summary_large_image the card renders as a thumbnail
              beside text, which wastes the artwork entirely. */}
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content="SellWant" />
          <meta name="twitter:description" content={BLURB} />
          <meta name="twitter:image" content={`${SITE}/og.png`} />
        </Head>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerTitleStyle: typeScale.heading,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {/* index re-exports the feed: `/` is the shop window, not a gate. */}
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="feed" options={{ headerShown: false }} />
        <Stack.Screen name="signin" options={{ headerShown: false }} />
        <Stack.Screen name="terms" options={{ title: 'Terms', headerBackTitle: 'Back' }} />
        <Stack.Screen name="privacy" options={{ title: 'Privacy', headerBackTitle: 'Back' }} />
        <Stack.Screen name="admin" options={{ title: 'Admin', headerBackTitle: 'Back' }} />
        <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        <Stack.Screen name="auth/reset" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="deal/[id]" options={{ title: 'Handoff', headerBackTitle: 'Back' }} />
        <Stack.Screen name="deals" options={{ title: 'Your deals', headerBackTitle: 'Back' }} />
        <Stack.Screen name="offers" options={{ title: 'Offers', headerBackTitle: 'Back' }} />
        <Stack.Screen name="my-listings" options={{ title: 'Your listings', headerBackTitle: 'Back' }} />
        <Stack.Screen name="u/[id]" options={{ title: 'Profile', headerBackTitle: 'Back' }} />
        <Stack.Screen name="profile" options={{ title: 'Profile', headerBackTitle: 'Back' }} />
        <Stack.Screen name="create-event" options={{ title: 'New listing', headerBackTitle: 'Back' }} />
        <Stack.Screen name="event/[id]" options={{ title: 'Listing', headerBackTitle: 'Back' }} />
        <Stack.Screen name="edit/[id]" options={{ title: 'Edit listing', headerBackTitle: 'Back' }} />
        </Stack>
          <BottomNav />
        </View>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
