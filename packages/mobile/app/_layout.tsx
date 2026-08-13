import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider, useTheme } from '../src/theme';
import { CurrencyProvider } from '../src/currency';
import { I18nProvider } from '../src/i18n';
import { SessionProvider, useSession } from '../src/auth';
import { Screen, HomeSkeleton } from '../src/ui';

void SplashScreen.preventAutoHideAsync();

/**
 * Sends the guest to the right half of the app.
 *
 * Routing on session rather than rendering a conditional tree keeps a single
 * navigation stack: signing out pops to sign-in properly instead of leaving a
 * stale screen mounted underneath.
 */
function Gate() {
  const { c, isDark } = useTheme();
  const { token, ready } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === '(auth)';
    if (!token && !inAuth) router.replace('/(auth)/sign-in');
    else if (token && inAuth) router.replace('/(tabs)');
  }, [token, ready, segments, router]);

  if (!ready) {
    return <Screen><HomeSkeleton /></Screen>;
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.canvas },
          animation: 'slide_from_right',
          // iOS lets you swipe back from anywhere on the screen, not just the
          // left edge. Without this the guest has to hit a ~20pt strip, which
          // is the single most common way a React Native app gives itself away.
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      >
        <Stack.Screen name="(auth)/sign-in" options={{ gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
        <Stack.Screen name="bill" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="history" />
        <Stack.Screen name="stays" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="room" />
        <Stack.Screen name="settings" />
        {/*
          Real sheets rather than full-screen covers: they keep the screen
          underneath visible and shrunk back, which is what tells the guest
          this is a detour they can dismiss rather than somewhere they landed.
        */}
        <Stack.Screen
          name="check-in"
          options={{ presentation: 'formSheet', sheetGrabberVisible: true, sheetCornerRadius: 28 }}
        />
        <Stack.Screen
          name="check-out"
          options={{ presentation: 'formSheet', sheetGrabberVisible: true, sheetCornerRadius: 28 }}
        />
        <Stack.Screen
          name="ask"
          options={{ presentation: 'formSheet', sheetGrabberVisible: true, sheetCornerRadius: 28 }}
        />
        <Stack.Screen
          name="review"
          options={{ presentation: 'formSheet', sheetGrabberVisible: true, sheetCornerRadius: 28 }}
        />
        <Stack.Screen
          name="nfc"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="place/[id]" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  // Fraunces carries the app's voice; nothing renders until it is ready, or
  // the first paint would be in the system serif and reflow.
  const [fontsLoaded] = useFonts({
    Fraunces: require('../assets/fonts/Fraunces-600.ttf'),
    'Fraunces-Medium': require('../assets/fonts/Fraunces-500.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <I18nProvider>
            <CurrencyProvider>
              <SessionProvider>
                <Gate />
              </SessionProvider>
            </CurrencyProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
