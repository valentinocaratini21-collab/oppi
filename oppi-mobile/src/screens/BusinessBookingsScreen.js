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
import { useBusinessId } from '../hooks/useBusinessId';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs, label, shortDate } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

const FILTERS = [
  { value: '', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'confirmed', label: 'Confirmadas' },
  { value: 'completed', label: 'Realizadas' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'no_show_client', label: 'No vinieron' },
];

const STATUS_COLORS = {
  pending: colors.warning,
  confirmed: colors.primary,
  completed: colors.success,
  cancelled: colors.muted,
  no_show_client: colors.danger,
  no_show_pro: colors.danger,
};

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Reservas del negocio (ruta "BusinessBookings", params {businessId}).
 * Aceptar (confirmed) / rechazar (cancelled, con confirmación) /
 * marcar realizada (completed). Muestra la comisión Oppi del 15%.
 * "Voy en camino 🛵" en la reserva de hoy (el cliente ve el banner).
 * "El cliente no vino" en reservas realizadas, con la consecuencia
 * económica (el pago queda para el negocio) antes de confirmar.
 */
export function BusinessBookingsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  // Como tab no llegan params: se resuelve el negocio del usuario.
  const { businessId: paramBusinessId } = route.params || {};
  const { businessId, loadingBiz } = useBusinessId(paramBusinessId);
  const [bookings, setBookings] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState(null);

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const { bookings: all } = await api.bookings(filter ? { status: filter } : {});
      setBookings((all || []).filter((b) => String(b.business_id) === String(businessId)));
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar las reservas.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [businessId, filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  async function updateStatus(id, status) {
    setActingId(id);
    try {
      await api.updateBooking(id, { status });
      await load();
    } catch (e) {
      Alert.alert('Error', e.message || 'No se pudo actualizar la reserva.');
    } finally {
      setActingId(null);
    }
  }

  function confirmReject(id, clientName) {
    Alert.alert(
      'Rechazar reserva',
      `¿Seguro que querés rechazar la reserva de ${clientName}? El cliente recibe el aviso y se le devuelve el pago.`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Sí, rechazar',
          style: 'destructive',
          onPress: () => updateStatus(id, 'cancelled'),
        },
      ]
    );
  }

  async function markEnRoute(id) {
    setActingId(id);
    try {
      await api.markEnRoute(id);
      Alert.alert('¡Avisado! 🛵', 'El cliente ya ve que el profesional va en camino.');
      await load();
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos avisar.');
    } finally {
      setActingId(null);
    }
  }

  function confirmNoShow(b) {
    // Nueva política: pantalla de reportar no-show con promesas del dueño.
    navigation.navigate('ReportNoShow', {
      bookingId: b.id,
      asRole: 'pro',
      serviceName: b.service_name,
      otherName: b.client_name,
    });
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Reservas" onBack={() => navigation.goBack()} />
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[styles.chip, filter === f.value && styles.chipActive]}
            onPress={() => {
              setFilter(f.value);
              setLoading(true);
            }}
          >
            <Text style={[styles.chipText, filter === f.value && styles.chipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {(loading || loadingBiz) ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : !businessId ? (
          <Card>
            <Text style={styles.empty}>Todavía no registraste tu negocio 🏪</Text>
            <PrimaryButton
              title="Registrar mi negocio"
              onPress={() => navigation.navigate('BusinessOnboarding')}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        ) : bookings.length === 0 ? (
          <Card>
            <Text style={styles.empty}>No hay reservas acá todavía.</Text>
          </Card>
        ) : (
          bookings.map((b) => (
            <Card key={b.id}>
              <View style={styles.rowBetween}>
                <Text style={styles.client}>{b.client_name || 'Cliente'}</Text>
                <View style={[styles.status, { backgroundColor: `${STATUS_COLORS[b.status]}22` }]}>
                  <Text style={[styles.statusText, { color: STATUS_COLORS[b.status] }]}>
                    {label(b.status)}
                  </Text>
                </View>
              </View>
              <Text style={styles.sub}>
                {b.service_name}
                {b.created_at ? ` · Pedida el ${shortDate(b.created_at.slice(0, 10))}` : ''}
              </Text>
              <View style={styles.money}>
                <Text style={styles.commission}>
                  Comisión Oppi (15%): {gs(Math.round((Number(b.total_gs) || 0) * 0.15))}
                </Text>
                <Text style={styles.total}>{gs(b.total_gs)}</Text>
              </View>
              {b.en_route_at && (
                <Text style={styles.enRouteNote}>🛵 Avisado: el profesional va en camino.</Text>
              )}

              {b.status === 'pending' && (
                <View style={styles.actions}>
                  <PrimaryButton
                    title={actingId === b.id ? '…' : 'Aceptar'}
                    onPress={() => updateStatus(b.id, 'confirmed')}
                    disabled={actingId === b.id}
                    style={styles.btn}
                  />
                  <PrimaryButton
                    title="Rechazar"
                    variant="ghost"
                    onPress={() => confirmReject(b.id, b.client_name || 'el cliente')}
                    disabled={actingId === b.id}
                    style={styles.btn}
                  />
                </View>
              )}
              {b.status === 'confirmed' && b.slot_date === todayIso() && !b.en_route_at && (
                <>
                  <PrimaryButton
                    title="Voy en camino 🛵"
                    loading={actingId === b.id}
                    onPress={() => markEnRoute(b.id)}
                    disabled={actingId === b.id}
                    style={styles.fullBtn}
                  />
                  <Text style={styles.enRoutePolicyNote}>
                    Avisá cuando el profesional salga: si va en camino y llega, el turno no
                    cuenta como no-show y el cumplimiento del negocio queda protegido.
                  </Text>
                </>
              )}
              {b.status === 'confirmed' && (
                <PrimaryButton
                  title={actingId === b.id ? '…' : 'Marcar como realizada'}
                  variant="secondary"
                  onPress={() => updateStatus(b.id, 'completed')}
                  disabled={actingId === b.id}
                  style={styles.fullBtn}
                />
              )}
              {b.status === 'confirmed' && (
                <PrimaryButton
                  title="Cancelar reserva"
                  variant="danger"
                  onPress={() =>
                    navigation.navigate('CancelBooking', {
                      bookingId: b.id,
                      role: 'business',
                      serviceName: b.service_name,
                    })
                  }
                  style={styles.fullBtn}
                />
              )}
              {b.status === 'completed' && (
                <PrimaryButton
                  title="🚫 El cliente no vino"
                  variant="ghost"
                  loading={actingId === b.id}
                  onPress={() => confirmNoShow(b)}
                  disabled={actingId === b.id}
                  style={styles.fullBtn}
                />
              )}
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: spacing.md, paddingBottom: 0 },
  chip: {
    backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 8, paddingHorizontal: 14,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#fff' },
  inner: { padding: spacing.md },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  client: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  status: { borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 },
  statusText: { fontSize: fontSize.xs, fontWeight: '800' },
  sub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  money: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  commission: { fontSize: fontSize.xs, color: colors.muted },
  total: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: { flex: 1, minHeight: 44 },
  fullBtn: { marginTop: spacing.sm, minHeight: 44 },
  enRouteNote: { color: colors.success, fontWeight: '700', fontSize: fontSize.sm, marginTop: spacing.sm },
  enRoutePolicyNote: { color: colors.muted, fontSize: fontSize.xs, marginTop: spacing.xs, lineHeight: 18 },
});
