import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useBusinessId } from '../hooks/useBusinessId';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs, label, shortDate } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Agenda del negocio (ruta "BusinessAgenda", params {businessId}).
 *
 * NOTA backend: las reservas de un negocio no traen fecha/hora de turno
 * (los slots son solo de profesionales individuales), así que la agenda
 * muestra arriba las pendientes "por confirmar" y abajo, por día, las
 * reservas solicitadas ese día (según fecha de creación).
 */
const STATUS_COLORS = {
  pending: colors.warning,
  confirmed: colors.primary,
  completed: colors.success,
  cancelled: colors.muted,
};

function nextDays(n) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ iso, label: i === 0 ? 'Hoy' : shortDate(iso) });
  }
  return out;
}

export function BusinessAgendaScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  // Como tab no llegan params: se resuelve el negocio del usuario.
  const { businessId: paramBusinessId } = route.params || {};
  const { businessId, loadingBiz } = useBusinessId(paramBusinessId);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days] = useState(() => nextDays(7));
  const [selectedDay, setSelectedDay] = useState(() => nextDays(7)[0].iso);
  const [actingId, setActingId] = useState(null);

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    try {
      const { bookings: all } = await api.bookings();
      setBookings((all || []).filter((b) => String(b.business_id) === String(businessId)));
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar la agenda.');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  async function respondBooking(id, accept) {
    setActingId(id);
    try {
      await api.updateBooking(id, { status: accept ? 'confirmed' : 'cancelled' });
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
      `¿Seguro que querés rechazar la reserva de ${clientName}?`,
      [
        { text: 'No', style: 'cancel' },
        { text: 'Sí, rechazar', style: 'destructive', onPress: () => respondBooking(id, false) },
      ]
    );
  }

  const pending = bookings
    .filter((b) => b.status === 'pending')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const dayBookings = bookings
    .filter((b) => (b.created_at || '').slice(0, 10) === selectedDay && b.status !== 'pending')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  function bookingCard(b, showActions) {
    return (
      <Card key={b.id}>
        <View style={styles.rowBetween}>
          <Text style={styles.client}>{b.client_name || 'Cliente'}</Text>
          <View style={[styles.status, { backgroundColor: `${STATUS_COLORS[b.status]}22` }]}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[b.status] }]}>{label(b.status)}</Text>
          </View>
        </View>
        <Text style={styles.sub}>
          {b.service_name} · {gs(b.total_gs)}
        </Text>
        {showActions && (
          <View style={styles.actions}>
            <PrimaryButton
              title={actingId === b.id ? '…' : 'Aceptar'}
              onPress={() => respondBooking(b.id, true)}
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
      </Card>
    );
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Agenda" onBack={() => navigation.goBack()} />
      {(loading || loadingBiz) ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : !businessId ? (
        <View style={[styles.inner, { padding: spacing.md }]}>
          <Card>
            <Text style={styles.empty}>Todavía no registraste tu negocio 🏪</Text>
            <PrimaryButton
              title="Registrar mi negocio"
              onPress={() => navigation.navigate('BusinessOnboarding')}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Text style={styles.sec}>⏳ Por confirmar</Text>
          {pending.length === 0 ? (
            <Card><Text style={styles.empty}>Nada pendiente. 👌</Text></Card>
          ) : (
            pending.map((b) => bookingCard(b, true))
          )}

          <Text style={styles.sec}>📅 Solicitadas por día</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayStrip}>
            {days.map((d) => (
              <TouchableOpacity
                key={d.iso}
                style={[styles.dayChip, selectedDay === d.iso && styles.dayChipActive]}
                onPress={() => setSelectedDay(d.iso)}
              >
                <Text style={[styles.dayText, selectedDay === d.iso && styles.dayTextActive]}>
                  {d.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {dayBookings.length === 0 ? (
            <Card><Text style={styles.empty}>Sin reservas solicitadas este día.</Text></Card>
          ) : (
            dayBookings.map((b) => bookingCard(b, false))
          )}

          <Text style={styles.note}>
            El horario exacto de cada turno lo confirmás con el cliente al aceptar la reserva.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  sec: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  client: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  status: { borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 },
  statusText: { fontSize: fontSize.xs, fontWeight: '800' },
  sub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: { flex: 1, minHeight: 44 },
  dayStrip: { marginBottom: spacing.sm },
  dayChip: {
    backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 16, marginRight: 8,
  },
  dayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  dayTextActive: { color: '#fff' },
  note: { fontSize: fontSize.xs, color: colors.muted, textAlign: 'center', marginTop: spacing.lg, lineHeight: 18 },
});
