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
import { useAuth } from '../store/AuthContext';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs, label, shortDate } from '../utils';
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
 * Hub de gestión del negocio (ruta "MyBusiness").
 * Header con badge de verificación, stats, accesos y pendientes con
 * aceptar/rechazar. Si no hay negocio creado → CTA al alta.
 *
 * Sección "Ganancias" (GET /api/business/earnings?periodo=semana|mes):
 * toggle Semana/Mes, tarjetas brutos / comisión 15% / neto / reservas /
 * ticket promedio, y gráfico de barras por servicio con Views
 * (sin dependencias nuevas). Estado vacío si no hay datos.
 */
export function MyBusinessScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [business, setBusiness] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [pendingDocs, setPendingDocs] = useState(0);
  const [unread, setUnread] = useState(0);
  const [actingId, setActingId] = useState(null);

  // Ganancias: toggle semana/mes → GET /api/business/earnings?periodo=
  const [earnPeriod, setEarnPeriod] = useState('semana');
  const [earnings, setEarnings] = useState(null);
  const [earnLoading, setEarnLoading] = useState(false);
  const [earnError, setEarnError] = useState('');

  const load = useCallback(async () => {
    try {
      const { businesses } = await api.businesses();
      const mine = (businesses || []).find((b) => b.user_id === user?.id) || null;
      setBusiness(mine);
      if (mine) {
        const [{ bookings: all }, { documents }, { notifications }] = await Promise.all([
          api.bookings(),
          api.businessDocuments(mine.id).catch(() => ({ documents: [] })),
          api.notifications({ unread: 1 }).catch(() => ({ notifications: [] })),
        ]);
        setBookings((all || []).filter((b) => b.business_id === mine.id));
        setPendingDocs(
          (documents || []).filter((d) => d.status === 'pending').length
        );
        setUnread((notifications || []).length);
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar tu negocio.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  const loadEarnings = useCallback(async (periodo) => {
    setEarnLoading(true);
    setEarnError('');
    try {
      const data = await api.getEarnings(periodo);
      setEarnings(data);
    } catch (e) {
      setEarnings(null);
      setEarnError(e.message || 'No pudimos cargar las ganancias.');
    } finally {
      setEarnLoading(false);
    }
  }, []);

  useEffect(() => {
    if (business) loadEarnings(earnPeriod);
  }, [business, earnPeriod, loadEarnings]);

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
      `¿Seguro que querés rechazar la reserva de ${clientName}? Se le avisa al cliente.`,
      [
        { text: 'No', style: 'cancel' },
        { text: 'Sí, rechazar', style: 'destructive', onPress: () => respondBooking(id, false) },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.muted}>Cargando tu negocio…</Text>
      </View>
    );
  }

  // Sin negocio → CTA al alta.
  if (!business) {
    return (
      <View style={styles.wrap}>
        <ScreenHeader title="Mi negocio" />
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🏪</Text>
          <Text style={styles.emptyTitle}>Todavía no registraste tu negocio</Text>
          <Text style={styles.emptySub}>
            Publicalo en 2 minutos y empezá a recibir reservas con pago total al confirmar.
          </Text>
          <PrimaryButton
            title="Registrar mi negocio"
            onPress={() => navigation.navigate('BusinessOnboarding')}
            style={{ minHeight: 52, borderRadius: 16, alignSelf: 'stretch' }}
          />
        </View>
      </View>
    );
  }

  const verified = business.verification_status === 'verified';
  const pending = bookings.filter((b) => b.status === 'pending');
  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  const month = new Date().toISOString().slice(0, 7);
  const incomeMonth = bookings
    .filter((b) => (b.status === 'confirmed' || b.status === 'completed') && (b.created_at || '').startsWith(month))
    .reduce((a, b) => a + (Number(b.total_gs) || 0), 0);

  const MENU = [
    { route: 'BusinessAgenda', icon: '📅', label: 'Agenda' },
    { route: 'BusinessBookings', icon: '📝', label: 'Reservas', badge: pending.length },
    { route: 'BusinessServices', icon: '💈', label: 'Mis servicios' },
    { route: 'BusinessBranches', icon: '🏪', label: 'Sucursales' },
    { route: 'BusinessClients', icon: '👥', label: 'Clientes' },
    { route: 'BusinessStats', icon: '📊', label: 'Reportes' },
    { route: 'BusinessCoupons', icon: '🎟️', label: 'Cupones' },
    { route: 'BusinessTeam', icon: '👥', label: 'Equipo' },
    { route: 'BusinessReviews', icon: '⭐', label: 'Reseñas' },
    { route: 'BusinessDocuments', icon: '📄', label: 'Documentos', badge: pendingDocs },
    { route: 'BusinessCancellationHistory', icon: '📋', label: 'Cancelaciones' },
    { route: 'BusinessNotifications', icon: '🔔', label: 'Notificaciones', badge: unread },
    { route: 'BusinessProfile', icon: '👁', label: 'Ver mi perfil' },
    { route: 'HelpChat', icon: '💬', label: 'Ayuda y soporte' },
  ];

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Mi negocio" />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <Card style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{business.name}</Text>
            <Text style={styles.sub}>
              {(business.categories || []).join(' · ')}
              {business.barrio ? ` · 📍 ${business.barrio}` : ''}
            </Text>
          </View>
          <View style={[styles.badge, verified ? styles.badgeOk : styles.badgeWarn]}>
            <Text style={[styles.badgeText, verified ? styles.badgeTextOk : styles.badgeTextWarn]}>
              {verified ? '✓ Verificado' : 'En verificación'}
            </Text>
          </View>
        </Card>

        {pendingDocs > 0 && (
          <TouchableOpacity onPress={() => navigation.navigate('BusinessDocuments', { businessId: business.id })}>
            <Card style={styles.warnCard}>
              <Text style={styles.warnTitle}>📄 Te faltan {pendingDocs} documento{pendingDocs === 1 ? '' : 's'}</Text>
              <Text style={styles.warnSub}>Subilos cuando quieras para el badge de verificado.</Text>
            </Card>
          </TouchableOpacity>
        )}

        <Text style={styles.sec}>Hoy</Text>
        <View style={styles.stats}>
          <Card style={styles.stat}>
            <Text style={styles.statNum}>{confirmed.length}</Text>
            <Text style={styles.statLabel}>Confirmadas</Text>
          </Card>
          <Card style={styles.stat}>
            <Text style={styles.statNum}>{pending.length}</Text>
            <Text style={styles.statLabel}>Pendientes</Text>
          </Card>
          <Card style={styles.stat}>
            <Text style={styles.statNum}>{gs(incomeMonth)}</Text>
            <Text style={styles.statLabel}>Ingresos del mes</Text>
          </Card>
        </View>

        <Text style={styles.sec}>💰 Ganancias</Text>
        <View style={styles.segRow}>
          {[
            { id: 'semana', label: 'Semana' },
            { id: 'mes', label: 'Mes' },
          ].map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.seg, earnPeriod === p.id && styles.segActive]}
              onPress={() => setEarnPeriod(p.id)}
              activeOpacity={0.85}
            >
              <Text style={[styles.segText, earnPeriod === p.id && styles.segTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {earnLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
        ) : earnError ? (
          <TouchableOpacity onPress={() => loadEarnings(earnPeriod)} activeOpacity={0.85}>
            <Card>
              <Text style={styles.empty}>{earnError} Tocá para reintentar.</Text>
            </Card>
          </TouchableOpacity>
        ) : earnings && (earnings.reservas_count || 0) > 0 ? (
          <>
            <View style={styles.stats}>
              <Card style={styles.stat}>
                <Text style={styles.statNum}>{gs(earnings.ingresos_brutos)}</Text>
                <Text style={styles.statLabel}>Brutos</Text>
              </Card>
              <Card style={styles.stat}>
                <Text style={styles.statNum}>{gs(earnings.comision)}</Text>
                <Text style={styles.statLabel}>Comisión Oppi (15%)</Text>
              </Card>
              <Card style={[styles.stat, styles.statNeto]}>
                <Text style={[styles.statNum, styles.statNetoNum]}>{gs(earnings.neto)}</Text>
                <Text style={styles.statLabel}>Neto para vos</Text>
              </Card>
            </View>
            <View style={styles.stats}>
              <Card style={styles.stat}>
                <Text style={styles.statNum}>{earnings.reservas_count}</Text>
                <Text style={styles.statLabel}>Reservas</Text>
              </Card>
              <Card style={styles.stat}>
                <Text style={styles.statNum}>{gs(earnings.ticket_promedio)}</Text>
                <Text style={styles.statLabel}>Ticket promedio</Text>
              </Card>
            </View>

            {(earnings.por_servicio || []).length > 0 && (
              <Card style={styles.chartCard}>
                <Text style={styles.chartTitle}>Por servicio</Text>
                <BarChart items={earnings.por_servicio} />
              </Card>
            )}
          </>
        ) : (
          <Card>
            <Text style={styles.empty}>
              Todavía no hay ganancias este {earnPeriod === 'semana' ? 'semana' : 'mes'}. Cuando tengas reservas confirmadas, acá vas a ver tus números.
            </Text>
          </Card>
        )}

        {pending.length > 0 && (
          <>
            <Text style={styles.sec}>⏳ Reservas por confirmar</Text>
            {pending.slice(0, 3).map((b) => (
              <Card key={b.id}>
                <View style={styles.rowBetween}>
                  <Text style={styles.bClient}>{b.client_name || 'Cliente'}</Text>
                  <Text style={styles.bDate}>{b.created_at ? shortDate(b.created_at.slice(0, 10)) : ''}</Text>
                </View>
                <Text style={styles.bSub}>
                  {b.service_name} · {gs(b.total_gs)}
                </Text>
                <View style={styles.actions}>
                  <PrimaryButton
                    title={actingId === b.id ? '…' : 'Aceptar'}
                    onPress={() => respondBooking(b.id, true)}
                    disabled={actingId === b.id}
                    style={styles.acceptBtn}
                  />
                  <PrimaryButton
                    title="Rechazar"
                    variant="ghost"
                    onPress={() => confirmReject(b.id, b.client_name || 'el cliente')}
                    disabled={actingId === b.id}
                    style={styles.rejectBtn}
                  />
                </View>
              </Card>
            ))}
            {pending.length > 3 && (
              <TouchableOpacity onPress={() => navigation.navigate('BusinessBookings', { businessId: business.id })}>
                <Text style={styles.more}>Ver las {pending.length} pendientes →</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        <Text style={styles.sec}>Gestión</Text>
        <View style={styles.grid}>
          {MENU.map((m) => (
            <TouchableOpacity
              key={m.route}
              style={styles.tile}
              onPress={() => navigation.navigate(m.route, { businessId: business.id })}
            >
              <Text style={styles.tileIcon}>{m.icon}</Text>
              <Text style={styles.tileLabel}>{m.label}</Text>
              {!!m.badge && (
                <View style={styles.tileBadge}>
                  <Text style={styles.tileBadgeText}>{m.badge}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: colors.muted },
  inner: { padding: spacing.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: 12 },
  emptyEmoji: { fontSize: 64 },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptySub: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { fontSize: fontSize.lg, fontWeight: '900', color: colors.text },
  sub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  badge: { borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12 },
  badgeOk: { backgroundColor: '#E6F7ED' },
  badgeWarn: { backgroundColor: '#FFF4E0' },
  badgeText: { fontSize: fontSize.xs, fontWeight: '800' },
  badgeTextOk: { color: colors.success },
  badgeTextWarn: { color: colors.warning },
  warnCard: { borderLeftWidth: 4, borderLeftColor: colors.warning },
  warnTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  warnSub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  sec: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: fontSize.md, fontWeight: '900', color: colors.text, textAlign: 'center' },
  statLabel: { fontSize: fontSize.xs, color: colors.muted, marginTop: 4, textAlign: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bClient: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  bDate: { fontSize: fontSize.xs, color: colors.muted },
  bSub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  acceptBtn: { flex: 1, minHeight: 44 },
  rejectBtn: { flex: 1, minHeight: 44 },
  more: { color: colors.primary, fontWeight: '700', fontSize: fontSize.sm, textAlign: 'center', marginTop: spacing.sm },

  // Ganancias
  segRow: {
    flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, padding: 4, marginBottom: spacing.sm,
  },
  seg: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, alignItems: 'center' },
  segActive: { backgroundColor: colors.primary },
  segText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.muted },
  segTextActive: { color: '#fff' },
  statNeto: { backgroundColor: colors.light, borderWidth: 1, borderColor: colors.primary },
  statNetoNum: { color: colors.primary },
  empty: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  chartCard: { marginTop: spacing.sm },
  chartTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  chart: { gap: spacing.md },
  barRow: { gap: 4 },
  barMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  barName: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, flex: 1, marginRight: 8 },
  barVal: { fontSize: fontSize.sm, fontWeight: '800', color: colors.primary },
  barTrack: {
    height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden',
  },
  barFill: { height: 10, borderRadius: 5, backgroundColor: colors.primary },
  barSub: { fontSize: fontSize.xs, color: colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: '31%', aspectRatio: 1, backgroundColor: colors.card, borderRadius: radius.card,
    alignItems: 'center', justifyContent: 'center', gap: 6,
    shadowColor: '#1A1A2E', shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  tileIcon: { fontSize: 28 },
  tileLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.text, textAlign: 'center' },
  tileBadge: {
    position: 'absolute', top: 8, right: 8, backgroundColor: colors.danger,
    borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6,
  },
  tileBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
