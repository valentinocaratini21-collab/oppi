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
import { useAuth } from '../store/AuthContext';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { CancelPolicyBanner } from '../components/CancelPolicyBanner';
import { gs, label, dateTimeEs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

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
 * Detalle de reserva (ruta "BookingDetail").
 *
 * Params: { bookingId }.
 * Muestra estado, servicio, fecha/hora, profesional/negocio (+ sucursal),
 * precio, banner de cancelación gratis/comodines y botones según
 * el estado y el rol: [Chat] [Reprogramar] [Cancelar] [Voy en camino 🛵]
 * (pro, día del servicio) [Reportar no-show].
 *
 * "Mis reservas" navega acá al tocar cada tarjeta.
 */
export function BookingDetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { bookingId } = route.params || {};
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    if (!bookingId) {
      setLoading(false);
      return;
    }
    try {
      const data = await api.booking(bookingId);
      setBooking(data.booking || data);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar la reserva.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [bookingId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  // ¿Soy el cliente de esta reserva? (si no, la veo como profesional/negocio)
  function amClient(b) {
    if (!b) return true;
    if (user?.id && b.client_id) return String(b.client_id) === String(user.id);
    return true;
  }

  async function openChat(b) {
    setActing(true);
    try {
      const otherId = b.pro_user_id || b.business_user_id || null;
      if (otherId) {
        const { conversation } = await api.createConversation({ participants: [otherId] });
        navigation.navigate('Chat', {
          conversationId: conversation.id,
          title: amClient(b) ? b.pro_name || b.business_name || 'Chat' : b.client_name || 'Chat',
        });
      } else {
        navigation.navigate('Conversations');
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos abrir el chat.');
    } finally {
      setActing(false);
    }
  }

  async function markEnRoute(b) {
    setActing(true);
    try {
      await api.markEnRoute(b.id);
      await load();
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos avisar que vas en camino.');
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.muted}>Cargando la reserva…</Text>
      </View>
    );
  }

  if (!booking) {
    return (
      <View style={styles.wrap}>
        <ScreenHeader title="Reserva" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>😕</Text>
          <Text style={styles.emptyTitle}>No encontramos esa reserva</Text>
          <PrimaryButton title="Volver" onPress={() => navigation.goBack()} />
        </View>
      </View>
    );
  }

  const b = booking;
  const client = amClient(b);
  const role = client ? 'cliente' : 'pro';
  const bookingDate = String(b.date || b.slot_date || b.starts_at || '').slice(0, 10);
  const isToday = bookingDate === todayIso();
  const cancellable = b.status === 'pending' || b.status === 'confirmed';

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Detalle de reserva" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.service}>{b.service_name || 'Servicio'}</Text>
            <View style={[styles.badge, { backgroundColor: STATUS_COLORS[b.status] || colors.muted }]}>
              <Text style={styles.badgeText}>{label(b.status)}</Text>
            </View>
          </View>
          <Text style={styles.when}>
            📅 {dateTimeEs(b.starts_at || (bookingDate ? `${bookingDate} ${b.time || ''}` : ''))}
          </Text>
          <Text style={styles.who}>
            {client
              ? `👤 ${b.pro_name || b.business_name || 'Profesional'}`
              : `👤 ${b.client_name || 'Cliente'}`}
          </Text>
          {(b.branch_name || b.sucursal_nombre) && (
            <Text style={styles.who}>🏪 Sucursal: {b.branch_name || b.sucursal_nombre}</Text>
          )}
        </Card>

        <Card>
          <View style={styles.priceRow}>
            <View>
              <Text style={styles.priceLabel}>Total pagado</Text>
              <Text style={styles.price}>{gs(b.total_gs)}</Text>
            </View>
          </View>
        </Card>

        {b.en_route_at && (
          <Card style={styles.enRouteCard}>
            <Text style={styles.enRouteText}>🛵 ¡Va en camino! Te llega en un rato.</Text>
          </Card>
        )}

        {cancellable && <CancelPolicyBanner bookingId={b.id} />}

        <Text style={styles.sec}>Acciones</Text>

        <PrimaryButton
          title={acting ? '…' : '💬 Chat'}
          disabled={acting}
          onPress={() => openChat(b)}
          style={styles.btn}
        />

        {client && b.status === 'confirmed' && (
          <PrimaryButton
            title="🔁 Reprogramar"
            variant="secondary"
            onPress={() =>
              navigation.navigate('MainTabs', { screen: 'Reservas', params: { rescheduleFor: b.id } })
            }
            style={styles.btn}
          />
        )}

        {!client && b.status === 'confirmed' && isToday && !b.en_route_at && (
          <>
            <PrimaryButton
              title="Voy en camino 🛵"
              loading={acting}
              onPress={() => markEnRoute(b)}
              style={styles.btn}
            />
            <Text style={styles.hint}>
              Avisá cuando salgas: si vas en camino y llegás, el turno no cuenta como
              no-show y tu cumplimiento queda protegido.
            </Text>
          </>
        )}

        {cancellable && (
          <PrimaryButton
            title="Cancelar reserva"
            variant="danger"
            onPress={() =>
              navigation.navigate('CancelBooking', {
                bookingId: b.id,
                role,
                serviceName: b.service_name,
              })
            }
            style={styles.btn}
          />
        )}

        {(b.status === 'completed' || b.status === 'no_show_client' || b.status === 'no_show_pro') && (
          <PrimaryButton
            title={client ? '😕 El profesional no vino' : '🚫 El cliente no vino'}
            variant="ghost"
            onPress={() =>
              navigation.navigate('ReportNoShow', {
                bookingId: b.id,
                asRole: role,
                serviceName: b.service_name,
                otherName: client ? b.pro_name : b.client_name,
              })
            }
            style={styles.btn}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12, padding: spacing.lg },
  muted: { color: colors.muted },
  inner: { padding: spacing.md },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  service: { fontSize: fontSize.lg, fontWeight: '900', color: colors.text, flex: 1 },
  badge: { borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12 },
  badgeText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '800' },
  when: { fontSize: fontSize.md, color: colors.text, fontWeight: '700', marginTop: spacing.sm },
  who: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  priceLabel: { fontSize: fontSize.xs, color: colors.muted, fontWeight: '700' },
  price: { fontSize: fontSize.lg, fontWeight: '900', color: colors.text, marginTop: 2 },
  enRouteCard: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  enRouteText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
  sec: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  btn: { minHeight: 52, borderRadius: 16, marginTop: spacing.sm },
  hint: { fontSize: fontSize.xs, color: colors.muted, marginTop: 4, lineHeight: 18 },
  emptyEmoji: { fontSize: 64 },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, textAlign: 'center' },
});
