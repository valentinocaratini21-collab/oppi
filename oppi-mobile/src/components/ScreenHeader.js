import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontSize, spacing } from '../theme';

/**
 * Header de pantalla: back opcional + título centrado.
 * Se usa dentro de las pantallas del stack (las tabs tienen su propio header nativo).
 */
export function ScreenHeader({ title, onBack, right }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.row}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={styles.back} hitSlop={12}>
            <Text style={styles.backText}>‹ Volver</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.back} />
        )}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.right}>{right || null}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { minWidth: 64 },
  backText: { color: colors.primary, fontSize: fontSize.md, fontWeight: '600' },
  title: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, flex: 1, textAlign: 'center' },
  right: { minWidth: 64, alignItems: 'flex-end' },
});
