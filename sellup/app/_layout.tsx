import React from 'react';
import { Stack } from 'expo-router';
import { Platform, StatusBar } from 'react-native';
import { ErrorBoundary } from './error-boundary';
import Colors from '@/constants/colors';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: 'index',
};

export default function RootLayout() {
  // Session state lives in Supabase's own storage; screens read it through
  // services/data. Nothing to bootstrap here.
  return (
    <ErrorBoundary>
      <StatusBar 
        barStyle="light-content" 
        backgroundColor={Colors.background} 
      />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: Colors.background,
          },
          headerTintColor: Colors.text,
          headerTitleStyle: {
            fontWeight: 'bold',
          },
          headerShadowVisible: false,
          contentStyle: {
            backgroundColor: Colors.background,
          },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="feed"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="auth/callback"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="categories"
          options={{
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="parties"
          options={{
            title: 'Parties',
            headerBackTitle: 'Categories',
          }}
        />
        <Stack.Screen
          name="concerts"
          options={{
            title: 'Concerts',
            headerBackTitle: 'Categories',
          }}
        />
        <Stack.Screen
          name="sports"
          options={{
            title: 'Sports',
            headerBackTitle: 'Categories',
          }}
        />
        <Stack.Screen
          name="theater"
          options={{
            title: 'Theater',
            headerBackTitle: 'Categories',
          }}
        />
        <Stack.Screen
          name="phones"
          options={{
            title: 'Phones',
            headerBackTitle: 'Categories',
          }}
        />
        <Stack.Screen
          name="mens-clothing"
          options={{
            title: "Men's Clothing",
            headerBackTitle: 'Categories',
          }}
        />
        <Stack.Screen
          name="event/[id]"
          options={{
            title: 'Event Details',
            headerBackTitle: 'Back',
          }}
        />
        <Stack.Screen
          name="create-event"
          options={{
            title: 'Create Listing',
            headerBackTitle: 'Back',
          }}
        />
        <Stack.Screen
          name="profile"
          options={{
            title: 'Profile',
            headerBackTitle: 'Back',
          }}
        />
        <Stack.Screen
          name="personal-info"
          options={{
            title: 'Personal Information',
            headerBackTitle: 'Profile',
          }}
        />
        <Stack.Screen
          name="payment-methods"
          options={{
            title: 'Payment Methods',
            headerBackTitle: 'Profile',
          }}
        />
        <Stack.Screen
          name="add-payment-method"
          options={{
            title: 'Add Payment Method',
            headerBackTitle: 'Payment Methods',
          }}
        />
        <Stack.Screen
          name="my-buy-listings"
          options={{
            title: 'My Buy Listings',
            headerBackTitle: 'Profile',
          }}
        />
        <Stack.Screen
          name="my-sell-listings"
          options={{
            title: 'My Sell Listings',
            headerBackTitle: 'Profile',
          }}
        />
        <Stack.Screen
          name="manage-listings"
          options={{
            title: 'Manage Listings',
            headerBackTitle: 'Profile',
          }}
        />
        <Stack.Screen
          name="history"
          options={{
            title: 'Transaction History',
            headerBackTitle: 'Profile',
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            title: 'Settings',
            headerBackTitle: 'Profile',
          }}
        />
      </Stack>
    </ErrorBoundary>
  );
}