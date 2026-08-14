import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
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
import { SafeAreaProvider } from 'react-native-safe-area-context';
import BottomNav from '@/components/BottomNav';
import { ErrorBoundary } from './error-boundary';
import { colors, type as typeScale } from '@/constants/theme';

export const unstable_settings = {
  initialRouteName: 'index',
};

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
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
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="feed" options={{ headerShown: false }} />
        <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="deal/[id]" options={{ title: 'Handoff', headerBackTitle: 'Back' }} />
        <Stack.Screen name="deals" options={{ title: 'Your deals', headerBackTitle: 'Back' }} />
        <Stack.Screen name="offers" options={{ title: 'Offers', headerBackTitle: 'Back' }} />
        <Stack.Screen name="my-listings" options={{ title: 'Your listings', headerBackTitle: 'Back' }} />
        <Stack.Screen name="u/[id]" options={{ title: 'Profile', headerBackTitle: 'Back' }} />
        <Stack.Screen name="profile" options={{ title: 'Profile', headerBackTitle: 'Back' }} />
        <Stack.Screen name="create-event" options={{ title: 'New listing', headerBackTitle: 'Back' }} />
        <Stack.Screen name="event/[id]" options={{ title: 'Listing', headerBackTitle: 'Back' }} />
        </Stack>
          <BottomNav />
        </View>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
