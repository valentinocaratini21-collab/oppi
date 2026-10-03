import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';

/**
 * Puntitos de comodines: 3 círculos, los `filled` primeros en primario.
 * Se usa en Cancelar reserva, Mi cumplimiento e Historial de cancelaciones.
 */
export function WildcardDots({ balance = 0, total = 3, size = 18 }) {
  const n = Math.max(0, Math.min(total, Number(balance) || 0));
  return (
    <View style={styles.row} accessibilityLabel={`${n} de ${total} comodines`}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            { width: size, height: size, borderRadius: size / 2 },
            i < n ? styles.dotOn : styles.dotOff,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  dotOn: { backgroundColor: colors.primary },
  dotOff: { backgroundColor: colors.border },
  dot: {},
});
