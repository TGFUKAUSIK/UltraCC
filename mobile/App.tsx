/**
 * App.tsx — root. Loads the board's two typefaces, wraps the app in the
 * AppProvider and the safe-area provider, gates on the biometric app lock when
 * enabled, and switches between the login screen and the signed-in tab shell.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme, type Theme as NavTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useFonts } from 'expo-font';
// One subpath per face: importing the package root pulls all fifteen files of a
// family into the bundle, and the board only ever sets seven of them.
import { BricolageGrotesque_500Medium } from '@expo-google-fonts/bricolage-grotesque/500Medium';
import { BricolageGrotesque_600SemiBold } from '@expo-google-fonts/bricolage-grotesque/600SemiBold';
import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque/700Bold';
import { BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque/800ExtraBold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono/700Bold';
import { AppProvider, useApp } from './src/state/AppContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { LoginScreen } from './src/screens/LoginScreen';
import { LoadingView } from './src/components/ui';
import { FONT } from './src/theme';

const LOCK_KEY = 'ultracc:applock';

/**
 * The same two families the web board sets: Bricolage Grotesque for display and
 * headings, JetBrains Mono for times, codes, rooms and numbers. The keys match
 * FONT / MONO in src/theme.ts — rename one and rename the other.
 */
const BOARD_FONTS = {
  BricolageGrotesque_500Medium,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
};

function Root() {
  const { theme, authenticated, loading } = useApp();
  const [lockGate, setLockGate] = useState<'checking' | 'open' | 'locked'>('checking');

  const unlock = useCallback(async () => {
    setLockGate('checking');
    const stored = await SecureStore.getItemAsync(LOCK_KEY).catch(() => null);
    if (stored !== '1') {
      setLockGate('open');
      return;
    }
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock UltraCC' });
    setLockGate(result.success ? 'open' : 'locked');
  }, []);

  useEffect(() => {
    unlock();
  }, [unlock]);

  const navTheme: NavTheme = theme.dark
    ? { ...DarkTheme, colors: { ...DarkTheme.colors, primary: theme.accent, background: theme.background, card: theme.surface, text: theme.text, border: theme.border } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: theme.accent, background: theme.background, card: theme.surface, text: theme.text, border: theme.border } };

  if (loading || lockGate === 'checking') {
    return (
      <>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <LoadingView label="Opening UltraCC…" />
      </>
    );
  }

  if (lockGate === 'locked') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background, padding: 24 }}>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <Text style={{ color: theme.text, fontFamily: FONT.extrabold, fontSize: 18, marginBottom: 16 }}>UltraCC is locked</Text>
        <Pressable
          onPress={unlock}
          style={{ backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 28 }}
        >
          <Text style={{ color: theme.onAccent, fontFamily: FONT.bold, fontSize: 15 }}>Unlock</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      {authenticated ? <RootNavigator /> : <LoginScreen />}
    </NavigationContainer>
  );
}

export default function App() {
  // Held on the same "Opening UltraCC…" screen the app already shows while the
  // session and theme load, so the board face is on screen before any text is.
  const [fontsReady, fontError] = useFonts(BOARD_FONTS);
  return (
    <SafeAreaProvider>
      <AppProvider>
        {fontsReady || fontError ? (
          <Root />
        ) : (
          <>
            <StatusBar style="light" />
            <LoadingView label="Opening UltraCC…" />
          </>
        )}
      </AppProvider>
    </SafeAreaProvider>
  );
}
