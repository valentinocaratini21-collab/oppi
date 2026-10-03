import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { Rating } from '../components/Rating';
import { ReviewPhotos } from '../components/ReviewPhotos';
import { gs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const TABS = [
  { value: 'servicios', label: 'Servicios' },
  { value: 'equipo', label: 'Equipo' },
  { value: 'resenas', label: 'Reseñas' },
  { value: 'info', label: 'Info' },
];

const CANCELLATION_FULL =
  'Podés cancelar gratis hasta 3 horas antes del turno. Si cancelás con menos de 3 horas ' +
  'de anticipación o no te presentás, el pago no se devuelve. Si el negocio cancela tu ' +
  'reserva, te devolvemos el 100%. Pagás el total al confirmar la reserva.';

/**
 * Perfil público del negocio (ruta "BusinessProfile", params {businessId, initialTab?}).
 * Portada + acciones (reservar / llamar / cómo llegar), tabs Servicios |
 * Equipo | Reseñas | Info, y bottom bar sticky con safe-area.
 */
function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function openStatus(schedule) {
  const now = new Date();
  const entry = (schedule || []).find((s) => s.day === DAY_NAMES[now.getDay()]);
  if (!entry) return { open: false, text: 'Cerrado hoy' };
  const hm = now.getHours() * 60 + now.getMinutes();
  const toMin = (t) => {
    const [h, m] = String(t || '0:0').split(':').map(Number);
    return h * 60 + (m || 0);
  };
  if (hm >= toMin(entry.open) && hm < toMin(entry.close)) {
    return { open: true, text: `Abierto hasta las ${entry.close}` };
  }
  return { open: false, text: `Cerrado · abre ${entry.open}` };
}

export function BusinessProfileScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { businessId, initialTab } = route.params;
  const [business, setBusiness] = useState(null);
  const [services, setServices] = useState([]);
  const [team, setTeam] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(initialTab || 'servicios');

  const load = useCallback(async () => {
    try {
      const data = await api.business(businessId);
      setBusiness(data.business);
      setServices(data.services || []);
      setTeam(data.team || []);
      setReviews(data.reviews || []);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar el negocio.');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
    // Tracking de vista del perfil público (fire-and-forget: no bloquea ni
    // rompe nada si el endpoint aún no existe en el backend).
    api.trackBusinessView(businessId);
  }, [load]);

  const avg = useMemo(
    () => (reviews.length
      ? reviews.reduce((a, r) => a + Number(r.rating || 0), 0) / reviews.length
      : null),
    [reviews]
  );
  const status = useMemo(() => openStatus(business?.schedule), [business]);
  const verified = business?.verification_status === 'verified';

  async function share() {
    try {
      await Share.share({
        message: `Mirá ${business?.name} en Oppi: reservá y pagá online.`,
      });
    } catch {
      // El usuario cerró el diálogo.
    }
  }

  // Botón de favorito eliminado: no hay endpoint de favoritos para
  // negocios (solo para profesionales). Menos botones = menos fricción.

  function call() {
    if (business?.phone) {
      Linking.openURL(`tel:${business.phone}`).catch(() => {});
    } else {
      Alert.alert('Sin teléfono', 'Este negocio todavía no publicó su teléfono.');
    }
  }

  function directions() {
    const q = encodeURIComponent(
      [business?.address, business?.barrio].filter(Boolean).join(', ') || business?.name || ''
    );
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`).catch(() => {
      Alert.alert('Error', 'No pudimos abrir el mapa.');
    });
  }

  function bookService(serviceId) {
    navigation.navigate('BookingFlow', { businessId, serviceId });
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!business) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>No encontramos ese negocio.</Text>
        <PrimaryButton title="Volver" variant="ghost" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        {/* Portada */}
        <View style={styles.cover}>
          <Text style={styles.coverInitial}>{initials(business.name)}</Text>
          <View style={styles.topRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.iconBtn}>
              <Text style={styles.iconText}>‹</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={share} hitSlop={12} style={styles.iconBtn}>
                <Text style={styles.iconText}>⤴</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{business.name}</Text>
            <View style={[styles.badge, verified ? styles.badgeOk : styles.badgeWarn]}>
              <Text style={[styles.badgeText, verified ? styles.badgeTextOk : styles.badgeTextWarn]}>
                {verified ? '✓ Verificado' : 'En verificación'}
              </Text>
            </View>
          </View>
          {!!(business.categories || []).length && (
            <Text style={styles.cats}>{business.categories.join(' · ')}</Text>
          )}
          <View style={styles.metaRow}>
            {avg !== null ? <Rating value={avg} /> : <Text style={styles.meta}>Nuevo en Oppi</Text>}
            <Text style={styles.meta}>·</Text>
            <Text style={styles.meta}>{reviews.length} reseña{reviews.length === 1 ? '' : 's'}</Text>
          </View>
          <Text style={styles.address}>
            {[business.address, business.barrio].filter(Boolean).join(' · ') || 'Dirección a confirmar'}
          </Text>
          <Text style={[styles.open, status.open ? styles.openYes : styles.openNo]}>
            {status.open ? '🟢 ' : '🔴 '}{status.text}
          </Text>

          {/* Tabs */}
          <View style={styles.tabs}>
            {TABS.map((t) => (
              <TouchableOpacity
                key={t.value}
                style={[styles.tab, tab === t.value && styles.tabActive]}
                onPress={() => setTab(t.value)}
              >
                <Text style={[styles.tabText, tab === t.value && styles.tabTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {tab === 'servicios' && (
            services.length === 0 ? (
              <Card><Text style={styles.empty}>Este negocio todavía no cargó servicios.</Text></Card>
            ) : (
              services.map((s) => (
                <Card key={s.id}>
                  <TouchableOpacity
                    onPress={() =>
                      navigation.navigate('ServiceDetail', {
                        service: s,
                        businessId,
                        businessName: business?.name,
                      })
                    }
                    activeOpacity={0.85}
                  >
                    <Text style={styles.svcName}>{s.name}</Text>
                    <Text style={styles.svcSub}>{gs(s.price_gs)}</Text>
                    <Text style={styles.svcDetailLink}>Ver detalle →</Text>
                  </TouchableOpacity>
                  <PrimaryButton
                    title="Reservar"
                    onPress={() => bookService(s.id)}
                    style={{ minHeight: 44, marginTop: spacing.sm }}
                  />
                </Card>
              ))
            )
          )}

          {tab === 'equipo' && (
            team.length === 0 ? (
              <Card><Text style={styles.empty}>Sin equipo cargado.</Text></Card>
            ) : (
              team.map((m) => (
                <Card key={m.id} style={styles.memberRow}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(m.name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mName}>{m.name}</Text>
                    {!!m.role && <Text style={styles.mRole}>{m.role}</Text>}
                  </View>
                  <PrimaryButton
                    title={`Elegir`}
                    variant="ghost"
                    onPress={() =>
                      navigation.navigate('BookingFlow', {
                        businessId,
                        staffId: m.id,
                        staffName: m.name,
                      })
                    }
                    style={{ minHeight: 40, paddingHorizontal: 12 }}
                  />
                </Card>
              ))
            )
          )}

          {tab === 'resenas' && (
            reviews.length === 0 ? (
              <Card><Text style={styles.empty}>Todavía no hay reseñas.</Text></Card>
            ) : (
              reviews.map((r) => (
                <Card key={r.id}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.author}>{r.from || 'Cliente'}</Text>
                    <Rating value={r.rating} />
                  </View>
                  {!!r.text && <Text style={styles.rText}>{r.text}</Text>}
                  <ReviewPhotos photos={r.photos} />
                  {!!r.reply_text && (
                    <View style={styles.replyBox}>
                      <Text style={styles.replyTitle}>Respuesta de {business.name}:</Text>
                      <Text style={styles.replyText}>{r.reply_text}</Text>
                    </View>
                  )}
                </Card>
              ))
            )
          )}

          {tab === 'info' && (
            <>
              <Card>
                <Text style={styles.infoTitle}>🕐 Horarios</Text>
                {DAY_NAMES.map((d) => {
                  const entry = (business.schedule || []).find((s) => s.day === d);
                  return (
                    <View key={d} style={styles.schedRow}>
                      <Text style={styles.schedDay}>{d}</Text>
                      <Text style={styles.schedHours}>
                        {entry ? `${entry.open} – ${entry.close}` : 'Cerrado'}
                      </Text>
                    </View>
                  );
                })}
              </Card>
              <Card>
                <Text style={styles.infoTitle}>📋 Política de cancelación</Text>
                <Text style={styles.infoText}>{CANCELLATION_FULL}</Text>
              </Card>
              <Card>
                <Text style={styles.infoTitle}>💳 Métodos de pago</Text>
                <Text style={styles.infoText}>
                  Pago online con tarjeta al reservar (hoy en modo simulado). También aceptamos
                  efectivo, transferencia o tarjeta en el local.
                </Text>
              </Card>
              {!!business.ruc && (
                <Card>
                  <Text style={styles.infoTitle}>🧾 Datos</Text>
                  <Text style={styles.infoText}>RUC: {business.ruc}</Text>
                </Card>
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* Bottom bar sticky */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <PrimaryButton
          title="Reservar"
          onPress={() => bookService(services[0]?.id)}
          style={styles.bookBtn}
        />
        <PrimaryButton title="📞 Llamar" variant="ghost" onPress={call} style={styles.sideBtn} />
        <PrimaryButton title="📍 Cómo llegar" variant="ghost" onPress={directions} style={styles.sideBtn} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: colors.muted },
  cover: {
    height: 200, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  coverInitial: { fontSize: 72, fontWeight: '900', color: 'rgba(255,255,255,0.9)' },
  topRow: {
    position: 'absolute', top: 48, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  iconText: { fontSize: 20, color: colors.text, fontWeight: '700' },
  body: { padding: spacing.md, marginTop: -24, backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  name: { fontSize: fontSize.xl, fontWeight: '900', color: colors.text, flex: 1 },
  badge: { borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12 },
  badgeOk: { backgroundColor: '#E6F7ED' },
  badgeWarn: { backgroundColor: '#FFF4E0' },
  badgeText: { fontSize: fontSize.xs, fontWeight: '800' },
  badgeTextOk: { color: colors.success },
  badgeTextWarn: { color: colors.warning },
  cats: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  meta: { fontSize: fontSize.sm, color: colors.muted },
  address: { fontSize: fontSize.sm, color: colors.text, marginTop: 6 },
  open: { fontSize: fontSize.sm, fontWeight: '700', marginTop: 4 },
  openYes: { color: colors.success },
  openNo: { color: colors.danger },
  tabs: {
    flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.pill,
    padding: 4, marginTop: spacing.md, marginBottom: spacing.sm,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.muted },
  tabTextActive: { color: '#fff' },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
  svcName: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  svcSub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  svcDetailLink: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '700', marginTop: 4 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: fontSize.md },
  mName: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  mRole: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  author: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  rText: { fontSize: fontSize.sm, color: colors.text, marginTop: 8, lineHeight: 20 },
  replyBox: {
    marginTop: spacing.sm, backgroundColor: colors.light, borderRadius: radius.button,
    padding: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.primary,
  },
  replyTitle: { fontSize: fontSize.xs, fontWeight: '800', color: colors.primary },
  replyText: { fontSize: fontSize.sm, color: colors.text, marginTop: 4, lineHeight: 20 },
  infoTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  infoText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 22 },
  schedRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  schedDay: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
  schedHours: { fontSize: fontSize.sm, color: colors.muted },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border,
  },
  bookBtn: { flex: 2, minHeight: 52, borderRadius: 16 },
  sideBtn: { flex: 1, minHeight: 52, borderRadius: 16 },
});
