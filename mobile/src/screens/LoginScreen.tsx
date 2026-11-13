/**
 * LoginScreen.tsx — VTOP sign-in.
 *
 * Credentials transit the gateway over HTTPS and are never persisted on the
 * device or on the gateway. The CAPTCHA is read on the server, exactly as the
 * web app reads it: vtop-gateway solves VTOP's image and reports the text with a
 * confidence, and this screen only pre-fills the code when that confidence
 * clears MIN_AUTO_FILL_CONFIDENCE (mobile/src/lib/captcha.ts). Below the floor
 * the box stays empty, because a wrong CAPTCHA is a failed login on the
 * student's real VTOP account and the portal locks accounts after repeated
 * failures. The image always stays on screen and the field always stays
 * editable, so a student can override the guess or type their own at any time.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../state/AppContext';
import { VtopError, type CaptchaChallenge } from '../lib/gateway';
import { autoFillCaptcha } from '../lib/captcha';
import { Button, Caption, Row } from '../components/ui';
import { PAGE, RADIUS, SP, TYPE, FONT } from '../theme';

/** A CAPTCHA image arrives as a data URI; tolerate bare base64 from an older gateway. */
function imageUri(imageBase64: string): string {
  if (!imageBase64) return '';
  return imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
}

export function LoginScreen() {
  const { theme, client, login, campus } = useApp();
  const [regNo, setRegNo] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [captchaUri, setCaptchaUri] = useState('');
  /** True while the gateway's own read of the CAPTCHA filled the box. */
  const [autoFilled, setAutoFilled] = useState(false);
  const [arming, setArming] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // An armed session lets a refresh reuse it instead of re-rolling a new one,
  // and a manual entry must not be overwritten by a late server answer.
  const armedRef = useRef(false);
  const typedRef = useRef(false);

  const applyChallenge = (challenge: CaptchaChallenge) => {
    setCaptchaUri(imageUri(challenge.imageBase64));
    const guess = autoFillCaptcha(challenge);
    if (typedRef.current) {
      // The student has started answering; their text wins over any guess.
      setAutoFilled(false);
    } else {
      setCaptcha(guess);
      setAutoFilled(!!guess);
    }
  };

  const loadCaptcha = async () => {
    try {
      setArming(true);
      setError('');
      let challenge: CaptchaChallenge;
      try {
        challenge = armedRef.current
          ? await client.getCaptcha()
          : await client.initializeSession();
      } catch {
        // A refresh can fail on a session VTOP already dropped; re-arm fully once.
        armedRef.current = false;
        challenge = await client.initializeSession();
      }
      if (challenge.imageBase64) armedRef.current = true;
      applyChallenge(challenge);
    } catch (e) {
      armedRef.current = false;
      setError(e instanceof VtopError ? e.message : 'Could not reach VTOP. Check your connection and try again.');
    } finally {
      setArming(false);
    }
  };

  useEffect(() => {
    loadCaptcha();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!regNo.trim() || !password || !captcha.trim()) {
      setError('Enter your registration number, password and the CAPTCHA.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await login(regNo, password, captcha.trim());
    } catch (e) {
      const message = e instanceof VtopError ? e.message : 'VTOP login failed. Check your details and try again.';
      setError(message);
      typedRef.current = false;
      setCaptcha('');
      setAutoFilled(false);
      await loadCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = [styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }];
  const campusLabel = campus.charAt(0).toUpperCase() + campus.slice(1);

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={[styles.brand, { backgroundColor: theme.ink, borderColor: theme.inkBorder }]}>
            <View style={[styles.logoMark, { backgroundColor: theme.accent }]}>
              <Ionicons name="school" size={24} color={theme.onAccent} />
            </View>
            <Text style={[styles.logo, { color: theme.onInk }]}>UltraCC</Text>
            <Text style={[styles.tagline, { color: theme.onInkMuted }]}>
              Your VIT {campusLabel} student portal
            </Text>
          </View>

          <Text style={[TYPE.sectionTitle, styles.label, { color: theme.text }]}>Registration number</Text>
          <TextInput
            style={inputStyle}
            value={regNo}
            onChangeText={setRegNo}
            placeholder="e.g. 24BCE1234"
            placeholderTextColor={theme.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
          />

          <Text style={[TYPE.sectionTitle, styles.label, { color: theme.text }]}>Password</Text>
          <TextInput
            style={inputStyle}
            value={password}
            onChangeText={setPassword}
            placeholder="VTOP password"
            placeholderTextColor={theme.textMuted}
            secureTextEntry
          />

          <Row style={styles.captchaLabelRow}>
            <Text style={[TYPE.sectionTitle, styles.label, { color: theme.text }]}>CAPTCHA</Text>
            <Pressable onPress={loadCaptcha} hitSlop={8} disabled={arming}>
              <Row style={styles.refresh}>
                <Ionicons name={arming ? 'hourglass-outline' : 'refresh'} size={13} color={theme.accent} />
                <Text style={[TYPE.caption, { color: theme.accent }]}>New code</Text>
              </Row>
            </Pressable>
          </Row>

          {arming ? (
            <View style={[styles.captchaBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <ActivityIndicator color={theme.accent} />
            </View>
          ) : captchaUri ? (
            <Pressable onPress={loadCaptcha}>
              <Image source={{ uri: captchaUri }} style={styles.captcha} resizeMode="contain" />
            </Pressable>
          ) : (
            <Pressable onPress={loadCaptcha} style={[styles.captchaBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Caption>Tap to reload CAPTCHA</Caption>
            </Pressable>
          )}

          <TextInput
            style={inputStyle}
            value={captcha}
            onChangeText={(text) => {
              typedRef.current = true;
              setAutoFilled(false);
              setCaptcha(text);
            }}
            placeholder={autoFilled ? 'Filled in for you — edit if it looks wrong' : 'Type the characters above'}
            placeholderTextColor={theme.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {autoFilled ? (
            <View style={styles.autoRow}>
              <Ionicons name="sparkles" size={13} color={theme.success} />
              <Text style={[TYPE.caption, { color: theme.textMuted, flex: 1 }]}>
                Read from the image automatically. Tap the code if it does not match.
              </Text>
            </View>
          ) : null}

          {error ? (
            <View style={[styles.errorBox, { backgroundColor: theme.dangerSoft }]}>
              <Ionicons name="alert-circle" size={15} color={theme.danger} />
              <Text style={[TYPE.meta, { color: theme.danger, flex: 1 }]}>{error}</Text>
            </View>
          ) : null}

          <Button
            label={submitting ? 'Signing in…' : 'Sign in'}
            onPress={submit}
            disabled={submitting || arming}
            style={{ marginTop: SP.xl }}
          />

          <View style={styles.secureRow}>
            <Ionicons name="lock-closed" size={13} color={theme.textMuted} />
            <Text style={[TYPE.caption, { color: theme.textMuted, flex: 1, textTransform: 'none', letterSpacing: 0, fontFamily: FONT.medium, lineHeight: 17 }]}>
              Your credentials are sent over HTTPS to UltraCC, which signs in to VTOP on your behalf. They are never stored on this device.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: PAGE, paddingBottom: SP.xxl + 16 },
  brand: { borderRadius: RADIUS.xl, borderWidth: 1, alignItems: 'center', paddingVertical: SP.xxl, paddingHorizontal: SP.xl, marginBottom: SP.xl, marginTop: SP.sm, overflow: 'hidden' },
  logoMark: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: SP.md },
  logo: { fontFamily: FONT.extrabold, fontSize: 34, letterSpacing: -1.2 },
  tagline: { fontFamily: FONT.medium, fontSize: 14, marginTop: 5, textAlign: 'center' },
  label: { marginTop: SP.lg, marginBottom: SP.sm, textTransform: 'uppercase' },
  captchaLabelRow: { alignItems: 'center', justifyContent: 'space-between' },
  refresh: { gap: 4, alignItems: 'center', marginTop: SP.lg, marginBottom: SP.sm },
  input: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 13, fontFamily: FONT.medium, fontSize: 15 },
  captcha: { width: 190, height: 66, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: '#cbd5e1' },
  captchaBox: { width: 190, height: 66, borderRadius: RADIUS.sm, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP.sm },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: SP.lg, paddingHorizontal: 14, paddingVertical: 12, borderRadius: RADIUS.md },
  secureRow: { flexDirection: 'row', gap: 7, marginTop: SP.xl, alignItems: 'flex-start' },
});
