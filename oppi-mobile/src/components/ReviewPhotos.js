import React from 'react';
import { View, Image, StyleSheet, ScrollView } from 'react-native';
import { spacing } from '../theme';

/**
 * Fotos de una reseña (máx 3, URLs de /api/uploads).
 * Acepta strings o { url }. Si no hay fotos, no renderiza nada.
 */
export function ReviewPhotos({ photos }) {
  const urls = (photos || [])
    .map((p) => (typeof p === 'string' ? p : p?.url))
    .filter(Boolean)
    .slice(0, 3);
  if (!urls.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row}>
      {urls.map((u, i) => (
        <Image key={`${u}-${i}`} source={{ uri: u }} style={styles.thumb} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { marginTop: spacing.sm, flexDirection: 'row' },
  thumb: { width: 88, height: 88, borderRadius: 12, marginRight: spacing.sm },
});
