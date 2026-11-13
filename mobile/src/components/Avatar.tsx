/**
 * Avatar.tsx — the student's identity chip: the VTOP profile photo when the
 * toggle is on and it is available, otherwise a clean initials monogram.
 */

import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../state/AppContext';
import { FONT } from '../theme';

export function initialsFor(name: string | undefined | null): string {
  return (
    (name || 'Student')
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'U'
  );
}

export function Avatar({ name, dataUrl, size = 40 }: { name?: string | null; dataUrl?: string | null; size?: number }) {
  const { theme, showProfilePhoto } = useApp();
  const showPhoto = showProfilePhoto && !!dataUrl;
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.accentSoft },
      ]}
    >
      {showPhoto ? (
        <Image source={{ uri: dataUrl! }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <Text style={[styles.initials, { fontSize: size * 0.34, color: theme.accent }]}>
          {initialsFor(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initials: { fontFamily: FONT.extrabold },
});
