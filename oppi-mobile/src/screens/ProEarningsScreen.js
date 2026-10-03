import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Gráfico de barras por servicio, hecho con Views (sin dependencias).
 * items: [{ servicio_id, nombre, reservas, ingresos }]
 */
function BarChart({ items }) {
  const max = Math.max(1, ...items.map((i) => Number(i.ingresos || 0)));
  return (
    <View style={styles.chart}>
      {items.map((it) => (
        <View key={it.servicio_id ?? it.nombre} style={styles.barRow}>
          <View style={styles.barMeta}>
            <Text style={styles.barName} numberOfLines={1}>{it.nombre}</Text>
            <Text style={styles.barVal}>{gs(it.ingresos)}</Text>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${(Number(it.ingresos || 0) / max) * 100}%` }]} />
          </View>
          <Text style={styles.barSub}>{it.reservas} reserva{Number(it.reservas) === 1 ? '' : 's'}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Ganancias del PROFESIONAL (ruta "ProEarnings").
 * GET /api/pro/earnings?periodo=semana|mes →
 *   { ingresos_brutos, comision, neto, reservas_count, ticket_promedio, por_servicio[] }
 *
 * Se entra desde "Mis servicios" → "Ganancias". Los valores que el backend
 * no devuelva se muestran como "—" (render defensivo).
 */
export function ProEarningsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState('semana');
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await api.getProEarnings(period);
      setEarnings(data);
    } catch (e) {
      setEarnings(null);
      setError(e.message || 'No pudimos cargar las ganancias.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Ganancias" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <View style={styles.segRow}>
          {[
            { id: 'semana', label: 'Esta semana' },
            { id: 'mes', label: 'Este mes' },
          ].map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.seg, period === p.id && styles.segActive]}
              onPress={() => setPeriod(p.id)}
              activeOpacity={0.85}
            >
              <Text style={[styles.segText, period === p.id && styles.segTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : error ? (
          <TouchableOpacity onPress={load} activeOpacity={0.85}>
            <Card>
              <Text style={styles.empty}>{error} Tocá para reintentar.</Text>
            </Card>
          </TouchableOpacity>
        ) : !earnings || (num(earnings.reservas_count) || 0) === 0 ? (
          <Card>
            <Text style={styles.empty}>
              Todavía no hay ganancias esta {period === 'semana' ? 'semana' : 'mes'}. Cuando
              tengas reservas completadas, acá vas a ver tus números.
            </Text>
          </Card>
        ) : (
          <>
            <View style={styles.stats}>
              <Card style={[styles.stat, styles.statNeto]}>
                <Text style={[styles.statNum, styles.statNetoNum]}>
                  {num(earnings.neto) !== null ? gs(earnings.neto) : '—'}
                </Text>
                <Text style={styles.statLabel}>Neto para vos</Text>
              </Card>
              <Card style={styles.stat}>
                <Text style={styles.statNum}>
                  {num(earnings.ingresos_brutos) !== null ? gs(earnings.ingresos_brutos) : '—'}
                </Text>
                <Text style={styles.statLabel}>Brutos</Text>
              </Card>
            </View>
            <View style={styles.stats}>
              <Card style={styles.stat}>
                <Text style={styles.statNum}>{earnings.reservas_count}</Text>
                <Text style={styles.statLabel}>Reservas</Text>
              </Card>
              <Card style={styles.stat}>
                <Text style={styles.statNum}>
                  {num(earnings.ticket_promedio) !== null ? gs(earnings.ticket_promedio) : '—'}
                </Text>
                <Text style={styles.statLabel}>Ticket promedio</Text>
              </Card>
              {num(earnings.comision) !== null && (
                <Card style={styles.stat}>
                  <Text style={styles.statNum}>{gs(earnings.comision)}</Text>
                  <Text style={styles.statLabel}>Comisión Oppi</Text>
                </Card>
              )}
            </View>

            {(earnings.por_servicio || []).length > 0 && (
              <Card style={styles.chartCard}>
                <Text style={styles.chartTitle}>Por servicio</Text>
                <BarChart items={earnings.por_servicio} />
              </Card>
            )}

            <Text style={styles.note}>
              El neto es lo que te queda después de la comisión de Oppi.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  segRow: {
    flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, padding: 4, marginBottom: spacing.md,
  },
  seg: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, alignItems: 'center' },
  segActive: { backgroundColor: colors.primary },
  segText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.muted },
  segTextActive: { color: '#fff' },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: fontSize.md, fontWeight: '900', color: colors.text, textAlign: 'center' },
  statLabel: { fontSize: fontSize.xs, color: colors.muted, marginTop: 4, textAlign: 'center' },
  statNeto: { backgroundColor: colors.light, borderWidth: 1, borderColor: colors.primary },
  statNetoNum: { color: colors.primary },
  empty: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  chartCard: { marginTop: spacing.md },
  chartTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  chart: { gap: spacing.md },
  barRow: { gap: 4 },
  barMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  barName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, flex: 1, marginRight: 8 },
  barVal: { fontSize: fontSize.sm, fontWeight: '800', color: colors.primary },
  barTrack: { height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: 10, borderRadius: 5, backgroundColor: colors.primary },
  barSub: { fontSize: fontSize.xs, color: colors.muted },
  note: { fontSize: fontSize.xs, color: colors.muted, textAlign: 'center', marginTop: spacing.md, lineHeight: 18 },
});
