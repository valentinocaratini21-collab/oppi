import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Política de cancelación de Oppi (versión piloto).
 *
 * - 3 niveles de cancelación GRATIS según anticipación (free_until por reserva)
 * - Cancelación tardía (después del límite gratis): usa 1 comodín; sin comodines baja el cumplimiento
 * - Comodines: 3 por trimestre, +1 cada 10 reservas completadas (máx 3), reset a 3 cada trimestre
 * - "Voy en camino" protege el turno (cancelar después cuenta como no-show)
 * - 3 no-shows confirmados = cuenta suspendida
 * - "Estrellas ≠ cumplimiento"
 * - Badge "Piloto · Sin cargos económicos"
 */
const LEVELS = [
  {
    emoji: '🟢',
    title: 'Servicio en menos de 3 h',
    sub: 'Gratis hasta 15 min tras confirmar',
    desc: 'Si reservás con menos de 3 h de anticipación, podés cancelar gratis hasta 15 minutos después de confirmar.',
  },
  {
    emoji: '🟡',
    title: 'Servicio entre 3 y 24 h',
    sub: 'Gratis hasta 3 h antes',
    desc: 'Cancelás sin costo ni comodines hasta 3 horas antes del servicio.',
  },
  {
    emoji: '🔴',
    title: 'Servicio en 24 h o más',
    sub: 'Gratis hasta 24 h antes',
    desc: 'Cancelás sin costo ni comodines hasta 24 horas antes del servicio.',
  },
];

export function CancellationPolicyScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Política de cancelación" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}>
        {/* Badge piloto */}
        <View style={styles.pilotBadge}>
          <Text style={styles.pilotText}>🧪 Piloto · Sin cargos económicos</Text>
        </View>

        <Text style={styles.intro}>
          Cancelar a tiempo no cuesta nada. Cada reserva te muestra hasta cuándo podés cancelar gratis.
        </Text>

        {LEVELS.map((l) => (
          <View key={l.title} style={styles.card}>
            <View style={styles.levelHead}>
              <Text style={styles.levelEmoji}>{l.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.levelTitle}>{l.title}</Text>
                <Text style={styles.levelSub}>{l.sub}</Text>
              </View>
            </View>
            <Text style={styles.levelDesc}>{l.desc}</Text>
          </View>
        ))}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>🎟️ Comodines</Text>
          <Text style={styles.cardText}>
            Tenés 3 comodines por trimestre. Recuperás 1 cada 10 reservas completadas,
            sin pasar de 3. Al cambiar de trimestre, vuelven a 3. Son tu margen para
            los imprevistos de la vida real.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>⏰ Cancelación tardía</Text>
          <Text style={styles.cardText}>
            Si cancelás después de tu límite gratis, se usa 1 comodín. Durante el
            piloto no hay cargos económicos.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>📉 Sin comodines</Text>
          <Text style={styles.cardText}>
            Si te quedás sin comodines y cancelás tarde, la cancelación baja tu % de
            cumplimiento. El cumplimiento es tu reputación de persona que cumple.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>🛵 Voy en camino</Text>
          <Text style={styles.cardText}>
            Si el profesional avisa "Voy en camino" el día del servicio, el turno queda
            protegido: no cuenta como no-show aunque llegue unos minutos tarde.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>🚫 No-shows</Text>
          <Text style={styles.cardText}>
            No presentarse sin avisar es lo peor que podés hacer en Oppi.{' '}
            <Text style={styles.bold}>3 no-shows = suspensión de la cuenta.</Text> Vale para
            clientes y profesionales por igual.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>⭐ Estrellas ≠ cumplimiento</Text>
          <Text style={styles.cardText}>
            Las estrellas miden la <Text style={styles.bold}>calidad</Text> del trabajo. El
            cumplimiento mide si <Text style={styles.bold}>cumplís tus turnos</Text>. Son dos
            cosas distintas y se muestran por separado.
          </Text>
        </View>

        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.85} style={styles.cta}>
          <Text style={styles.ctaText}>Entendido</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  pilotBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.light,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: spacing.sm,
  },
  pilotText: { color: colors.primary, fontWeight: '800', fontSize: fontSize.sm },
  intro: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#1A1A2E',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  levelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 },
  levelEmoji: { fontSize: 28 },
  levelTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  levelSub: { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary, marginTop: 2 },
  levelDesc: { fontSize: fontSize.sm, color: colors.muted, lineHeight: 20 },
  cardTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: 6 },
  cardText: { fontSize: fontSize.sm, color: colors.muted, lineHeight: 20 },
  bold: { fontWeight: '800', color: colors.text },
  cta: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  ctaText: { color: '#fff', fontSize: fontSize.md, fontWeight: '700' },
});
