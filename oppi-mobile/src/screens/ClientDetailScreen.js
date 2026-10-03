import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { Rating } from '../components/Rating';
import { gs, label, dateTimeEs, dateEs } from '../utils';
import { colors, fontSize, spacing } from '../theme';

/**
 * Detalle de un cliente (ruta "ClientDetail", compartida pro/negocio).
 *
 * Params: { client, businessId? }.
 * Tarjeta resumen + historial de reservas (GET /api/bookings filtrado por
 * el cliente; si el backend no filtra, se filtra en la app).
 */
export function ClientDetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { client } = route.params || {};
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { bookings: all } = await api.bookings({ client_id: client?.id });
      let list = all || [];
      // Fallback: si el backend ignora el filtro, filtramos acá.
      if (client?.id && list.some((b) => String(b.client_id) !== String(client.id))) {
        list = list.filter((b) => String(b.client_id) === String(client.id));
      }
      setBookings(list);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar el historial.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  if (!client) {
    return (
      <View style={styles.wrap}>
        <ScreenHeader title="Cliente" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>😕</Text>
          <Text style={styles.emptyTitle}>No encontramos ese cliente</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title={client.nombre || 'Cliente'} onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.name}>{client.nombre || 'Cliente'}</Text>
            {Number(client.rating_promedio_dado) > 0 && (
              <Rating value={Number(client.rating_promedio_dado)} />
            )}
          </View>
          {!!client.barrio && <Text style={styles.meta}>📍 {client.barrio}</Text>}
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{Number(client.reservas_count || 0)}</Text>
              <Text style={styles.statLabel}>Reservas</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{gs(client.gasto_total)}</Text>
              <Text style={styles.statLabel}>Gastó</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>
                {client.ultima_visita ? dateEs(client.ultima_visita) : '—'}
              </Text>
              <Text style={styles.statLabel}>Última visita</Text>
            </View>
          </View>
        </Card>

        <Text style={styles.sec}>Historial de reservas</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : bookings.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>Sin reservas todavía 🗓️</Text>
            <Text style={styles.emptySub}>
              El historial aparece acá en cuanto este cliente reserve.
            </Text>
          </Card>
        ) : (
          bookings.map((b) => (
            <Card key={b.id}>
              <View style={styles.rowBetween}>
                <Text style={styles.bService}>{b.service_name || 'Servicio'}</Text>
                <Text style={[styles.bStatus, { color: statusColor(b.status) }]}>
                  {label(b.status)}
                </Text>
              </View>
              <Text style={styles.bMeta}>
                {dateTimeEs(b.starts_at || `${String(b.date || '').slice(0, 10)} ${b.time || ''}`)}
                {' · '}{gs(b.total_gs)}
              </Text>
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function statusColor(s) {
  if (s === 'completed') return colors.success;
  if (s === 'confirmed') return colors.primary;
  if (s === 'pending') return colors.warning;
  if (s === 'cancelled') return colors.muted;
  return colors.danger;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
  inner: { padding: spacing.md },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  name: { fontSize: fontSize.lg, fontWeight: '900', color: colors.text, flex: 1 },
  meta: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  stats: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  stat: { flex: 1, alignItems: 'center', backgroundColor: colors.bg, borderRadius: 12, padding: spacing.sm },
  statNum: { fontSize: fontSize.md, fontWeight: '900', color: colors.text, textAlign: 'center' },
  statLabel: { fontSize: fontSize.xs, color: colors.muted, marginTop: 4, textAlign: 'center' },
  sec: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  bService: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, flex: 1 },
  bStatus: { fontSize: fontSize.xs, fontWeight: '800' },
  bMeta: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  emptyEmoji: { fontSize: 64 },
  emptyTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptySub: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 20 },
});
