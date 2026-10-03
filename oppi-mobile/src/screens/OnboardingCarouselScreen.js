import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors, fontSize, spacing } from '../theme';

const SLIDES = [
  {
    emoji: '✨',
    title: 'Todos los servicios que necesitás, en un solo lugar',
    sub: 'Peluquería, electricidad, limpieza, clases y mucho más — cerca tuyo.',
  },
  {
    emoji: '⭐',
    title: 'Elegí el mejor profesional',
    sub: 'Reseñas reales, precios en guaraníes y perfiles verificados.',
  },
  {
    emoji: '📅',
    title: 'Reservá fácil y rápido',
    sub: 'Elegí el turno, pagá el total y listo. Te avisamos de todo.',
  },
];

/**
 * Carrusel de onboarding (primera vez que se abre la app).
 * AsyncStorage 'oppi_onboarding_done' marca que ya se vio.
 * Emoji grande, sin fotos. [Siguiente] avanza, [Omitir] salta,
 * [Comenzar] entra al login.
 */
export function OnboardingCarouselScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;
  const slide = SLIDES[index];

  async function finish() {
    try {
      await AsyncStorage.setItem('oppi_onboarding_done', '1');
    } catch {
      // Si no se puede guardar, igual se entra.
    }
    navigation.replace('Login');
  }

  function next() {
    if (last) finish();
    else setIndex(index + 1);
  }

  function goTo(i) {
    setIndex(i);
  }

  return (
    <View style={[styles.wrap, { paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.topRow}>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={finish} hitSlop={12}>
          <Text style={styles.skip}>Omitir</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.slide}>
        <Text style={styles.emoji}>{slide.emoji}</Text>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.sub}>{slide.sub}</Text>
      </View>

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <TouchableOpacity key={i} onPress={() => goTo(i)} hitSlop={8}>
            <View style={[styles.dot, i === index && styles.dotActive]} />
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.cta}>
        <PrimaryButton
          title={last ? 'Comenzar 🚀' : 'Siguiente'}
          onPress={next}
          style={{ minHeight: 52, borderRadius: 16 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  topRow: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingTop: spacing.lg },
  skip: { color: colors.muted, fontSize: fontSize.md, fontWeight: '600' },
  slide: { flex: 1, paddingHorizontal: spacing.lg * 2, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 96, marginBottom: spacing.lg },
  title: { fontSize: fontSize.xl, fontWeight: '900', color: colors.text, textAlign: 'center', lineHeight: 34 },
  sub: { fontSize: fontSize.md, color: colors.muted, textAlign: 'center', marginTop: spacing.md, lineHeight: 24 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginVertical: spacing.lg },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.primary, width: 24 },
  cta: { paddingHorizontal: spacing.lg },
});
