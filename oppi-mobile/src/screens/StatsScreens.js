import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useBusinessId } from '../hooks/useBusinessId';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Stats MVP del dueño (2026-10-03): tres pantallas DISTINTAS por rol,
 * tarjetas + barras, toggle semana/mes donde aplica.
 *  - Cliente → "Mi resumen" (ruta "ClientSummary", entrada: Mi perfil):
 *    reservas completadas, total gastado, Oppi Points y link a "Mi cumplimiento".
 *  - Profesional → "Estadísticas" (ruta "ProStats", entrada: su panel):
 *    ingresos, reservas (semana/mes), conversión visitas→reservas,
 *    tiempo de respuesta (mediana) y clientes recurrentes.
 *  - Negocio → "Reportes" (ruta "BusinessStats", entrada: su panel):
 *    ingresos, reservas (semana/mes), servicios más vendidos, top
 *    colaborador y clientes recurrentes.
 *
 * Datos: api.proStats / api.businessStats / api.meSummary. Mientras el
 * backend no tenga los campos nuevos, el cliente API completa con mocks
 * coherentes (ver src/api/client.js); los datos reales siempre ganan.
 */

// ---------- Primitivas compartidas (cada pantalla las compone distinto) ----------

/** % con 1 decimal, coma rioplatense: 34.5 → "34,5%". */
function fmtPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(1).replace('.', ',')}%`;
}

/** Minutos en lenguaje humano: 25 → "~25 min", 90 → "~1 h 30 min". */
function fmtMinutes(min) {
  const n = Math.round(Number(min));
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 60) return `~${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `~${h} h` : `~${h} h ${m} min`;
}

function PeriodToggle({ periodo, onChange }) {
  return (
    <View style={styles.segRow}>
      {[
        { id: 'semana', label: 'Semana' },
        { id: 'mes', label: 'Mes' },
      ].map((p) => (
        <TouchableOpacity
          key={p.id}
          style={[styles.seg, periodo === p.id && styles.segActive]}
          onPress={() => onChange(p.id)}
          activeOpacity={0.85}
        >
          <Text style={[styles.segText, periodo === p.id && styles.segTextActive]}>
            {p.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function StatCard({ value, label, style }) {
  return (
    <Card style={[styles.stat, style]}>
      <Text style={styles.statNum}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

function BarChart({ items, title }) {
  const max = Math.max(1, ...items.map((i) => Number(i.ingresos || 0)));
  return (
    <Card style={styles.chartCard}>
      <Text style={styles.chartTitle}>{title}</Text>
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
            <Text style={styles.barSub}>
              {it.reservas} reserva{Number(it.reservas) === 1 ? '' : 's'}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** Carga con loading/error/pull-to-refresh; `loadFn` devuelve el objeto de stats. */
function useStats(loadFn) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await loadFn());
    } catch (e) {
      setData(null);
      setError(e.message || 'No pudimos cargar los números.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadFn]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, refreshing, error, load, setRefreshing };
}

function StatsShell({ title, onBack, children, refreshing, onRefresh }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.wrap}>
      <ScreenHeader title={title} onBack={onBack} />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {children}
      </ScrollView>
    </View>
  );
}

function LoadingState() {
  return <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />;
}

function ErrorState({ error, onRetry }) {
  return (
    <TouchableOpacity onPress={onRetry} activeOpacity={0.85}>
      <Card>
        <Text style={styles.retry}>{error} Tocá para reintentar.</Text>
      </Card>
    </TouchableOpacity>
  );
}

// ---------- 1) CLIENTE: "Mi resumen" ----------

/** "Mi resumen" del CLIENTE (ruta "ClientSummary"). Sin toggle: totales de siempre. */
export function ClientSummaryScreen({ navigation }) {
  const { data, loading, refreshing, error, load, setRefreshing } = useStats(api.meSummary);

  const hasActivity =
    data && (Number(data.reservas_completadas) > 0 || Number(data.total_gastado_gs) > 0);
  const points = Number(data?.oppi_points) || 0;

  return (
    <StatsShell
      title="Mi resumen"
      onBack={() => navigation.goBack()}

      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        load();
      }}
    >
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={load} />
      ) : (
        <>
          <Text style={styles.hello}>Así va tu historia en Oppi 🎉</Text>

          {/* Hero: Oppi Points */}
          <Card style={styles.pointsHero}>
            <Text style={styles.pointsNum}>✨ {points}</Text>
            <Text style={styles.pointsLabel}>Oppi Points disponibles</Text>
            <Text style={styles.pointsSub}>
              Los ganás reservando e invitando amigos. Pronto vas a poder canjearlos.
            </Text>
          </Card>

          {hasActivity ? (
            <View style={styles.duo}>
              <StatCard
                value={Number(data.reservas_completadas) || 0}
                label="Reservas completadas"
              />
              <StatCard
                value={gs(data.total_gastado_gs)}
                label="Gastado en Oppi"
              />
            </View>
          ) : (
            <Card>
              <Text style={styles.emptyTitle}>Todavía no completaste reservas 🌱</Text>
              <Text style={styles.emptySub}>
                Cuando reserves y completes tu primer servicio, acá vas a ver
                tus números: reservas, gasto total y puntos.
              </Text>
            </Card>
          )}

          {/* Link a Mi cumplimiento */}
          <TouchableOpacity
            onPress={() => navigation.navigate('Compliance')}
            activeOpacity={0.85}
          >
            <Card style={styles.linkCard}>
              <View style={styles.linkRow}>
                <Text style={styles.linkIcon}>✅</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkTitle}>Mi cumplimiento</Text>
                  <Text style={styles.linkSub}>Tu % de turnos cumplidos y comodines</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </View>
            </Card>
          </TouchableOpacity>
        </>
      )}
    </StatsShell>
  );
}

// ---------- 2) PROFESIONAL: "Estadísticas" ----------

/** "Estadísticas" del PROFESIONAL (ruta "ProStats"). */
export function ProStatsScreen({ navigation }) {
  const [periodo, setPeriodo] = useState('semana');
  const loadFn = useCallback(() => api.proStats(periodo).then((d) => d.stats || d), [periodo]);
  const { data, loading, refreshing, error, load, setRefreshing } = useStats(loadFn);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  const hasData = data && Number(data.reservas_count || 0) > 0;

  return (
    <StatsShell
      title="Estadísticas"
      onBack={() => navigation.goBack()}

      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        load();
      }}
    >
      <PeriodToggle periodo={periodo} onChange={setPeriodo} />
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={load} />
      ) : !hasData ? (
        <Card>
          <Text style={styles.emptyTitle}>
            Todavía no hay números esta {periodo === 'semana' ? 'semana' : 'este mes'} 📊
          </Text>
          <Text style={styles.emptySub}>
            Cuando tengas reservas, acá vas a ver tus ingresos, tu conversión y
            cuántos clientes vuelven.
          </Text>
        </Card>
      ) : (
        <>
          {/* Hero: ingresos + reservas del período */}
          <Card style={styles.hero}>
            <Text style={styles.heroNum}>{gs(data.ingresos)}</Text>
            <Text style={styles.heroLabel}>
              de ingresos · {data.reservas_count} reserva{Number(data.reservas_count) === 1 ? '' : 's'} esta {periodo === 'semana' ? 'semana' : 'este mes'}
            </Text>
          </Card>

          {/* Conversión y respuesta: lo que más le importa al profesional */}
          <View style={styles.duo}>
            <StatCard
              value={fmtPct(data.conversion_pct ?? data.conversion)}
              label="Visitas → reservas"
            />
            <StatCard
              value={fmtMinutes(data.response_time_median_min)}
              label="Respuesta mediana"
            />
          </View>
          <View style={styles.duo}>
            <StatCard
              value={Number(data.clientes_recurrentes) || 0}
              label="Clientes recurrentes"
            />
            <StatCard
              value={fmtPct(data.recurrent_pct)}
              label="% que vuelve"
            />
          </View>

          {(data.top_servicios || []).length > 0 && (
            <BarChart items={data.top_servicios} title="Tus servicios top" />
          )}
        </>
      )}
    </StatsShell>
  );
}

// ---------- 3) NEGOCIO: "Reportes" ----------

/** "Reportes" del NEGOCIO (ruta "BusinessStats", params {businessId?}). */
export function BusinessStatsScreen({ navigation, route }) {
  const { businessId: paramBusinessId } = route.params || {};
  const { businessId, loadingBiz } = useBusinessId(paramBusinessId);
  const [periodo, setPeriodo] = useState('semana');
  const loadFn = useCallback(() => {
    if (!businessId) return Promise.resolve(null);
    return api.businessStats(businessId, periodo).then((d) => d.stats || d);
  }, [businessId, periodo]);
  const { data, loading, refreshing, error, load, setRefreshing } = useStats(loadFn);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  const busy = loading || loadingBiz;
  const hasData = data && Number(data.reservas_count || 0) > 0;
  const top = data?.top_staff;

  return (
    <StatsShell
      title="Reportes"
      onBack={() => navigation.goBack()}

      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        load();
      }}
    >
      <PeriodToggle periodo={periodo} onChange={setPeriodo} />
      {busy ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={load} />
      ) : !businessId ? (
        <Card>
          <Text style={styles.emptyTitle}>Todavía no registraste tu negocio 🏪</Text>
          <Text style={styles.emptySub}>
            Registralo para empezar a ver tus reportes de ingresos y equipo.
          </Text>
        </Card>
      ) : !hasData ? (
        <Card>
          <Text style={styles.emptyTitle}>
            Todavía no hay movimientos esta {periodo === 'semana' ? 'semana' : 'este mes'} 📊
          </Text>
          <Text style={styles.emptySub}>
            Cuando tu negocio reciba reservas, acá vas a ver ingresos, servicios
            más vendidos y el rendimiento de tu equipo.
          </Text>
        </Card>
      ) : (
        <>
          {/* Hero: ingresos del negocio */}
          <Card style={styles.heroBiz}>
            <Text style={styles.heroNum}>{gs(data.ingresos)}</Text>
            <Text style={styles.heroLabel}>
              de ingresos esta {periodo === 'semana' ? 'semana' : 'este mes'}
            </Text>
          </Card>

          <View style={styles.duo}>
            <StatCard
              value={Number(data.reservas_count) || 0}
              label="Reservas"
            />
            <StatCard
              value={`${Number(data.clientes_recurrentes) || 0} · ${fmtPct(data.recurrent_pct)}`}
              label="Recurrentes (nº y %)"
            />
          </View>

          {/* Top colaborador: la estrella del período */}
          {top && top.nombre ? (
            <Card style={styles.topCard}>
              <Text style={styles.topKicker}>⭐ Top colaborador</Text>
              <Text style={styles.topName}>{top.nombre}</Text>
              <Text style={styles.topSub}>
                {top.reservas_count} reserva{Number(top.reservas_count) === 1 ? '' : 's'} · {gs(top.ingresos)} generados
              </Text>
            </Card>
          ) : null}

          {(data.top_servicios || []).length > 0 && (
            <BarChart items={data.top_servicios} title="Servicios más vendidos" />
          )}
        </>
      )}
    </StatsShell>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  hello: {
    fontSize: fontSize.md, fontWeight: '800', color: colors.text,
    marginBottom: spacing.sm,
  },
  // Toggle semana/mes
  segRow: {
    flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, padding: 4, marginBottom: spacing.sm,
  },
  seg: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, alignItems: 'center' },
  segActive: { backgroundColor: colors.primary },
  segText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.muted },
  segTextActive: { color: '#fff' },
  // Tarjetas de stat
  duo: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  stat: { flex: 1, alignItems: 'center', marginBottom: 0 },
  statNum: { fontSize: fontSize.md, fontWeight: '900', color: colors.text, textAlign: 'center' },
  statLabel: { fontSize: fontSize.xs, color: colors.muted, marginTop: 4, textAlign: 'center' },
  // Heroes
  hero: { alignItems: 'center', marginBottom: spacing.sm },
  heroBiz: {
    alignItems: 'center', marginBottom: spacing.sm,
    borderLeftWidth: 4, borderLeftColor: colors.primary,
  },
  heroNum: { fontSize: fontSize.xl, fontWeight: '900', color: colors.primary },
  heroLabel: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4, textAlign: 'center' },
  // Cliente: puntos
  pointsHero: {
    alignItems: 'center', marginBottom: spacing.sm,
    backgroundColor: colors.primary, borderWidth: 0,
  },
  pointsNum: { fontSize: fontSize.xl, fontWeight: '900', color: '#fff' },
  pointsLabel: { fontSize: fontSize.sm, fontWeight: '700', color: '#fff', marginTop: 4 },
  pointsSub: {
    fontSize: fontSize.xs, color: '#fff', opacity: 0.85,
    marginTop: spacing.xs, textAlign: 'center', lineHeight: 18,
  },
  // Cliente: link a cumplimiento
  linkCard: { marginTop: spacing.sm },
  linkRow: { flexDirection: 'row', alignItems: 'center' },
  linkIcon: { fontSize: 26, marginRight: spacing.sm },
  linkTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  linkSub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  chevron: { fontSize: 24, color: colors.muted },
  // Negocio: top colaborador
  topCard: { marginBottom: spacing.sm, borderLeftWidth: 4, borderLeftColor: colors.warning },
  topKicker: { fontSize: fontSize.xs, fontWeight: '800', color: colors.warning, marginBottom: 4 },
  topName: { fontSize: fontSize.lg, fontWeight: '900', color: colors.text },
  topSub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  // Barras
  chartCard: { marginTop: spacing.xs },
  chartTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  chart: { gap: spacing.sm },
  barRow: { gap: 4 },
  barMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, flex: 1 },
  barVal: { fontSize: fontSize.sm, fontWeight: '800', color: colors.primary },
  barTrack: { height: 10, backgroundColor: colors.border, borderRadius: 5, overflow: 'hidden' },
  barFill: { height: 10, backgroundColor: colors.primary, borderRadius: 5 },
  barSub: { fontSize: fontSize.xs, color: colors.muted },
  // Estados
  emptyTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptySub: {
    fontSize: fontSize.sm, color: colors.muted, textAlign: 'center',
    marginTop: spacing.sm, lineHeight: 20,
  },
  retry: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', lineHeight: 20 },
});
