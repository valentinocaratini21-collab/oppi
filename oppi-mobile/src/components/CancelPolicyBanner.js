import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api/client';
import { dateTimeEs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Banner de política de cancelación para la tarjeta de una reserva confirmada.
 *
 * "Cancelación gratis hasta {fecha}. Comodines: {n} de 3." + link "Ver política".
 *
 * Si el endpoint nuevo aún no existe (404) no se muestra nada (gracia total:
 * el banner es informativo, nunca un error).
 */
export function CancelPolicyBanner({ bookingId }) {
  const navigation = useNavigation();
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .cancelPolicyPreview(bookingId)
      .then((p) => {
        if (alive) setInfo(p);
      })
      .catch(() => {
        /* endpoint aún no disponible → sin banner, sin error */
      });
    return () => {
      alive = false;
    };
  }, [bookingId]);

  if (!info) return null;

  const balance = Number(info.comodines?.balance ?? 3);
  const dentro = !!info.dentro_plazo_gratis || info.resolucion === 'gratis';

  return (
    <View style={[styles.banner, dentro ? styles.bannerOk : styles.bannerWarn]}>
      <Text style={styles.text}>
        {dentro
          ? `Cancelación gratis hasta ${dateTimeEs(info.free_until)}. `
          : 'Cancelación tardía: usa 1 comodín. '}
        Comodines: {balance} de 3.
      </Text>
      <TouchableOpacity
        onPress={() => navigation.navigate('CancellationPolicy')}
        hitSlop={8}
        activeOpacity={0.7}
      >
        <Text style={styles.link}>Ver política</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.button,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  bannerOk: { backgroundColor: '#E6F7ED' },
  bannerWarn: { backgroundColor: '#FFF4E0' },
  text: { fontSize: fontSize.xs, color: colors.text, lineHeight: 18, flex: 1, fontWeight: '600' },
  link: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '800' },
});
