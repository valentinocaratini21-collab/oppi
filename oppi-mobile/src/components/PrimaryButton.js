import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, fontSize, spacing } from '../theme';

/**
 * Botón primario del sistema visual: fondo #6B5BD0, texto blanco,
 * alto 52, bordes 16 (regla del dueño).
 * Variantes: 'primary' | 'secondary' (fondo claro) | 'danger' (rojo suave,
 * siempre con confirmación + consecuencia) | 'ghost' (outline).
 */
export function PrimaryButton({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}) {
  const bg =
    variant === 'secondary'
      ? colors.light
      : variant === 'danger'
        ? colors.dangerSoft
        : variant === 'ghost'
          ? 'transparent'
          : colors.primary;
  const fg =
    variant === 'secondary'
      ? colors.primary
      : variant === 'danger'
        ? colors.danger
        : variant === 'ghost'
          ? colors.primary
          : '#fff';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[
        styles.base,
        { backgroundColor: bg },
        variant === 'ghost' && styles.ghost,
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.text, { color: fg }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  ghost: {
    borderWidth: 1,
    borderColor: colors.primary,
  },
  disabled: { opacity: 0.6 },
  text: { fontSize: fontSize.md, fontWeight: '700' },
});
