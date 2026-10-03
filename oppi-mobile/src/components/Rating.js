import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors, fontSize } from '../theme';

/** Estrellas de rating: "★ 4.9" */
export function Rating({ value, style }) {
  if (value === null || value === undefined) return null;
  return (
    <Text style={[styles.rating, style]}>
      <Text style={styles.star}>★</Text> {Number(value).toFixed(1)}
    </Text>
  );
}

const styles = StyleSheet.create({
  rating: { fontSize: fontSize.sm, color: colors.text, fontWeight: '700' },
  star: { color: colors.warning },
});
