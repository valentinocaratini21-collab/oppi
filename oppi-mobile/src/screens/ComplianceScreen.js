import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { ScreenHeader } from '../components/ScreenHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { WildcardDots } from '../components/WildcardDots';
import { dateEs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Mi cumplimiento (desde el Perfil).
 *
 * - % grande de cumplimiento
 * - Sello "Profesional confiable" si ≥ 95%
 * - Comodines (puntitos), no-shows, próximo comodín + reset
 * - Estrellas aparte ("Estrellas ≠ cumplimiento")
 * - Link a la política de cancelación
 *
 * Si los endpoints nuevos aún no existen, muestra estado de error con reintento
 * (no se inventan números).
 */
export function ComplianceScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [wildcards, setWildcards] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, w] = await Promise.all([
        api.myCompliance().catch(() => null),
        api.myWildcards().catch(() => null),
      ]);
      if (!c && !w) throw new Error('Todavía no pudimos cargar tu cumplimiento. Probá en un rato.');
      setData(c);
      setWildcards(w || c?.comodines || c?.wildcards || null);
    } catch (e) {
      setError(e.message || 'No pudimos cargar tu cumplimiento.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pct = data?.compliance_pct ?? data?.cumplimiento ?? null;
  const confiable = pct != null && Number(pct) >= 95;
  const noShows = data?.no_shows ?? data?.noShows ?? 0;
  const cumplidos = data?.completed ?? data?.turnos_cumplidos ?? null;
  const tardias = data?.late_cancels ?? data?.cancelaciones_tardias ?? null;
  const rating = data?.rating_avg ?? data?.estrellas ?? null;
  const reviewsCount = data?.reviews_count ?? data?.resenas ?? null;
  const balance = Number(wildcards?.balance ?? 3);
  const proximoEn = wildcards?.proximo_en;
  const resetFecha = wildcards?.reset_fecha;

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Mi cumplimiento" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}>
        {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />}

        {!loading && error && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>😕 Algo salió mal</Text>
            <Text style={styles.cardText}>{error}</Text>
            <PrimaryButton title="Reintentar" onPress={load} style={{ marginTop: spacing.sm }} />
          </View>
        )}

        {!loading && !error && (
          <>
            {/* % grande */}
            <View style={styles.card}>
              <Text style={styles.pctLabel}>Tu cumplimiento</Text>
              <Text style={styles.pct}>{pct != null ? `${Math.round(Number(pct))}%` : '—'}</Text>
              <Text style={styles.cardText}>
                Es el % de turnos que cumplís sin cancelar tarde ni faltar. Es tu reputación
                de persona que cumple.
              </Text>
            </View>

            {/* Sello */}
            {confiable && (
              <View style={[styles.card, styles.sealCard]}>
                <Text style={styles.seal}>✅ Profesional confiable</Text>
                <Text style={styles.cardText}>
                  Tu cumplimiento está por encima del 95%. Los clientes lo ven en tu perfil.
                </Text>
              </View>
            )}

            {/* Stats */}
            <View style={styles.row}>
              <View style={[styles.card, styles.stat]}>
                <Text style={styles.statNum}>{cumplidos ?? '—'}</Text>
                <Text style={styles.statLabel}>Turnos cumplidos</Text>
              </View>
              <View style={[styles.card, styles.stat]}>
                <Text style={styles.statNum}>{tardias ?? '—'}</Text>
                <Text style={styles.statLabel}>Cancelaciones tardías</Text>
              </View>
              <View style={[styles.card, styles.stat]}>
                <Text style={[styles.statNum, Number(noShows) > 0 && styles.statDanger]}>{noShows}</Text>
                <Text style={styles.statLabel}>No-shows</Text>
              </View>
            </View>
            <Text style={styles.hint}>🚫 3 no-shows = suspensión de la cuenta.</Text>

            {/* Comodines */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🎟️ Tus comodines</Text>
              <View style={styles.dotsRow}>
                <WildcardDots balance={balance} size={22} />
                <Text style={styles.dotsLabel}>{balance} de 3</Text>
              </View>
              {proximoEn ? <Text style={styles.cardText}>Próximo comodín {proximoEn} de 10 reservas</Text> : null}
              {resetFecha ? (
                <Text style={styles.cardText}>Se resetean el {dateEs(resetFecha)}</Text>
              ) : null}
              {!proximoEn && !resetFecha && (
                <Text style={styles.cardText}>Recuperás 1 cada 10 reservas completadas, sin pasar de 3.</Text>
              )}
            </View>

            {/* Estrellas aparte */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>⭐ Tus estrellas</Text>
              <Text style={styles.stars}>
                {rating != null ? `★ ${Number(rating).toFixed(1)}` : 'Sin reseñas todavía'}
                {reviewsCount ? ` · ${reviewsCount} reseña${Number(reviewsCount) === 1 ? '' : 's'}` : ''}
              </Text>
              <Text style={styles.cardText}>
                Las estrellas miden la calidad de tu trabajo, no tu cumplimiento. Son dos cosas
                distintas.
              </Text>
            </View>

            <TouchableOpacity onPress={() => navigation.navigate('CancellationPolicy')} activeOpacity={0.85}>
              <Text style={styles.policyLink}>Ver política de cancelación →</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
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
  pctLabel: { fontSize: fontSize.sm, color: colors.muted, fontWeight: '700', textAlign: 'center' },
  pct: {
    fontSize: 64,
    fontWeight: '900',
    color: colors.primary,
    textAlign: 'center',
    marginVertical: spacing.xs,
  },
  sealCard: { borderLeftWidth: 4, borderLeftColor: colors.success },
  seal: { fontSize: fontSize.lg, fontWeight: '800', color: colors.success, marginBottom: 6 },
  cardTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  cardText: { fontSize: fontSize.sm, color: colors.muted, lineHeight: 20, marginTop: 4 },
  row: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: fontSize.xl, fontWeight: '900', color: colors.text },
  statDanger: { color: colors.danger },
  statLabel: { fontSize: fontSize.xs, color: colors.muted, marginTop: 4, textAlign: 'center' },
  hint: { fontSize: fontSize.xs, color: colors.muted, textAlign: 'center', marginBottom: spacing.sm },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  dotsLabel: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  stars: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginBottom: 4 },
  policyLink: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
