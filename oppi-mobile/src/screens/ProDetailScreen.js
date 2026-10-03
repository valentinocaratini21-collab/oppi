import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { Card } from '../components/Card';
import { Rating } from '../components/Rating';
import { ReviewPhotos } from '../components/ReviewPhotos';
import { PrimaryButton } from '../components/PrimaryButton';
import { gs, shortDate } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Perfil del profesional (dirección del dueño):
 * - Header con foto, atrás (<), corazón favorito y compartir.
 * - Nombre + ✓ verificado, rubro, ★ promedio (N reseñas) → salta a la tab Reseñas,
 *   barrio, "Responde en ~1 h".
 * - Acciones: [Reservar] violeta full-width + [Enviar mensaje] outline → Chat.
 * - Tabs: Servicios | Reseñas | Info.
 * - Servicios: nombre, precio Gs. grande.
 *   [Elegir] → BookingFlow con {serviceId} preseleccionado.
 * - Disponibilidad: carrusel de 14 días + chips de horarios (misma lógica de
 *   slots que BookingFlow). Horario lleno → chip outline "Avisame si se libera"
 *   → confirma → joinWaitlist.
 * - Reseñas: promedio + barras por estrella + respuestas del profesional.
 * - Sticky bottom bar: "Desde Gs. X" + [Reservar].
 *
 * Notas honestas de datos: el backend no expone foto, duración de servicio,
 * distancia, experiencia ni idiomas — esas filas solo aparecen si hay dato.
 */
const TABS = [
  { id: 'servicios', label: 'Servicios' },
  { id: 'resenas', label: 'Reseñas' },
  { id: 'info', label: 'Info' },
];

function isoDay(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function ProDetailScreen({ navigation, route }) {
  const { proId } = route.params;
  const { user, isLoggedIn } = useAuth();
  const insets = useSafeAreaInsets();

  const [professional, setProfessional] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [services, setServices] = useState([]);
  const [favorite, setFavorite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [tab, setTab] = useState('servicios');
  const [selectedServiceId, setSelectedServiceId] = useState(null);

  // Disponibilidad (misma lógica que BookingFlowScreen).
  const [slotsByDate, setSlotsByDate] = useState({});
  const [selectedDate, setSelectedDate] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.professional(proId);
      setProfessional(data.professional);
      setReviews(data.reviews || []);
      const { services: svcs } = await api.services({ professional_id: proId });
      setServices(svcs || []);
      const { slots } = await api.slots({ professional_id: proId });
      const grouped = {};
      for (const s of (slots || [])) {
        if (!grouped[s.date]) grouped[s.date] = [];
        grouped[s.date].push(s);
      }
      for (const k of Object.keys(grouped)) grouped[k].sort((a, b) => a.time.localeCompare(b.time));
      setSlotsByDate(grouped);
      if (isLoggedIn) {
        const { favorites } = await api.favorites();
        setFavorite((favorites || []).some((f) => f.id === proId));
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar el perfil.');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setSlotsLoading(false);
    }
  }, [proId, isLoggedIn]);

  useEffect(() => {
    load();
    // Tracking de vista del perfil público (fire-and-forget: no bloquea ni
    // rompe nada si el endpoint aún no existe en el backend).
    api.trackProfessionalView(proId);
  }, [load]);

  const next14 = useMemo(() => Array.from({ length: 14 }, (_, i) => isoDay(i)), []);
  const daySlots = selectedDate ? slotsByDate[selectedDate] || [] : [];

  const minPrice = useMemo(
    () => (services.length ? Math.min(...services.map((s) => s.price_gs)) : 0),
    [services]
  );

  const reviewStats = useMemo(() => {
    const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const r of reviews) {
      const k = Math.round(Number(r.rating)) || 0;
      if (dist[k] !== undefined) dist[k] += 1;
    }
    return dist;
  }, [reviews]);

  async function toggleFavorite() {
    if (!isLoggedIn) {
      Alert.alert('Entrá primero', 'Necesitás una cuenta para guardar favoritos.');
      return;
    }
    try {
      if (favorite) {
        await api.removeFavorite(proId);
        setFavorite(false);
      } else {
        await api.addFavorite(proId);
        setFavorite(true);
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'No se pudo actualizar favoritos.');
    }
  }

  async function shareProfile() {
    try {
      await Share.share({
        message: `Mirá a ${professional.name} en Oppi: ${professional.rating ? `★ ${Number(professional.rating).toFixed(1)}` : ''} — reservá tu turno por la app.`,
      });
    } catch {
      // el usuario cerró el diálogo
    }
  }

  async function chatWithPro() {
    if (!isLoggedIn) {
      Alert.alert('Entrá primero', 'Necesitás una cuenta para escribirle.');
      return;
    }
    try {
      const { conversation } = await api.createConversation({
        participants: [professional.user_id],
      });
      navigation.navigate('Chat', {
        conversationId: conversation.id,
        title: professional.name,
      });
    } catch (e) {
      Alert.alert('Error', e.message || 'No se pudo abrir el chat.');
    }
  }

  function goToBooking(svc, slot = null) {
    const chosen = svc || services.find((s) => s.id === selectedServiceId) || services[0];
    // BookingFlowScreen preselecciona services[0]: reordenamos para que el
    // elegido quede primero y además pasamos serviceId explícito.
    // Si el turno se eligió acá (chip de hora libre), lo pasamos como
    // preselectSlot para no tener que re-elegirlo en el flujo.
    const ordered = chosen
      ? [chosen, ...services.filter((s) => s.id !== chosen.id)]
      : services;
    navigation.navigate('BookingFlow', {
      proId,
      services: ordered,
      proName: professional.name,
      serviceId: chosen?.id ?? null,
      ...(slot ? { preselectSlot: { date: slot.date, time: slot.time } } : {}),
    });
  }

  async function joinWaitlistFor(slot) {
    if (!isLoggedIn) {
      Alert.alert('Entrá primero', 'Necesitás una cuenta para anotarte en la lista de espera.');
      return;
    }
    Alert.alert(
      'Avisame si se libera',
      `Te anotamos para el turno del ${shortDate(slot.date)} a las ${slot.time.slice(0, 5)} con ${professional.name}. Te avisamos si se libera.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Anotarme',
          onPress: async () => {
            setJoining(true);
            try {
              await api.joinWaitlist({
                professional_id: proId,
                service_id: selectedServiceId || services[0]?.id || null,
                slot_desc: `${shortDate(slot.date)} ${slot.time.slice(0, 5)}`,
              });
              Alert.alert('Listo ✅', 'Te avisamos en cuanto se libere ese turno.');
            } catch (e) {
              Alert.alert('No pudimos anotarte', e.message || 'Intentá de nuevo.');
            } finally {
              setJoining(false);
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!professional) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No encontramos ese profesional.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: spacing.md }}>
          <Text style={styles.link}>‹ Volver</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const rubro = (professional.categories || [])[0] || (professional.categories || []).join(' · ');

  return (
    <View style={styles.wrap}>
      {/* Header: atrás / favorito / compartir */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={toggleFavorite} hitSlop={12} style={styles.headerBtn}>
            <Text style={[styles.heart, favorite && styles.heartActive]}>
              {favorite ? '♥' : '♡'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={shareProfile} hitSlop={12} style={styles.headerBtn}>
            <Text style={styles.shareIcon}>⤴</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: 120 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(professional.name || '?').charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>
            {professional.name}{' '}
            {professional.verified ? <Text style={styles.verified}>✓</Text> : null}
          </Text>
          {rubro ? <Text style={styles.rubro}>{rubro}</Text> : null}
          <TouchableOpacity onPress={() => setTab('resenas')} hitSlop={8}>
            <Text style={styles.ratingLine}>
              <Text style={styles.star}>★</Text>{' '}
              {professional.rating ? Number(professional.rating).toFixed(1) : '—'}{' '}
              <Text style={styles.ratingCount}>({reviews.length} reseñas)</Text>
            </Text>
          </TouchableOpacity>
          <Text style={styles.meta}>
            {professional.barrio || 'Asunción'} · Responde en ~1 h
          </Text>
        </View>

        {/* Acciones */}
        <PrimaryButton
          title="Reservar"
          onPress={() => goToBooking(null)}
          style={styles.cta}
        />
        <PrimaryButton
          title="Enviar mensaje"
          variant="ghost"
          onPress={chatWithPro}
          style={styles.secondary}
        />

        {/* Tabs */}
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={[styles.tab, tab === t.id && styles.tabActive]}
              onPress={() => setTab(t.id)}
            >
              <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tab === 'servicios' && (
          <>
            {services.length === 0 && (
              <Card>
                <Text style={styles.empty}>Este profesional todavía no cargó servicios.</Text>
              </Card>
            )}
            {services.map((svc) => (
              <Card key={svc.id}>
                <View style={styles.svcRow}>
                  <TouchableOpacity
                    style={{ flex: 1 }}
                    onPress={() =>
                      navigation.navigate('ServiceDetail', {
                        service: svc,
                        proId,
                        proName: professional.name,
                      })
                    }
                    activeOpacity={0.85}
                  >
                    <Text style={styles.svcName}>{svc.name}</Text>
                    <Text style={styles.svcPrice}>{gs(svc.price_gs)}</Text>
                    <Text style={styles.svcDetailLink}>Ver detalle →</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.chooseBtn}
                    onPress={() => goToBooking(svc)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.chooseBtnText}>Elegir</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            ))}

            {/* Disponibilidad */}
            <Text style={styles.section}>Disponibilidad</Text>
            {slotsLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayRow}>
                  {next14.map((d) => {
                    const n = (slotsByDate[d] || []).filter((s) => s.status === 'free').length;
                    const active = selectedDate === d;
                    return (
                      <TouchableOpacity
                        key={d}
                        style={[styles.dayChip, active && styles.dayChipActive]}
                        onPress={() => setSelectedDate(active ? null : d)}
                      >
                        <Text style={[styles.dayChipText, active && styles.dayChipTextActive]}>
                          {shortDate(d)}
                        </Text>
                        <Text style={[styles.dayChipSub, active && styles.dayChipTextActive]}>
                          {n > 0 ? `${n} libre${n > 1 ? 's' : ''}` : '—'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {selectedDate && (
                  <View style={styles.timeWrap}>
                    {daySlots.length === 0 && (
                      <Text style={styles.empty}>Ese día no hay turnos publicados.</Text>
                    )}
                    {daySlots.map((s) =>
                      s.status === 'free' ? (
                        <TouchableOpacity
                          key={s.id}
                          style={styles.timeChip}
                          onPress={() => goToBooking(null, s)}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.timeChipText}>{s.time.slice(0, 5)}</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          key={s.id}
                          style={styles.timeChipFull}
                          onPress={() => joinWaitlistFor(s)}
                          disabled={joining}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.timeChipFullText}>{s.time.slice(0, 5)}</Text>
                          <Text style={styles.timeChipFullSub}>Avisame si se libera</Text>
                        </TouchableOpacity>
                      )
                    )}
                  </View>
                )}
              </>
            )}
          </>
        )}

        {tab === 'resenas' && (
          <>
            <Card>
              <View style={styles.avgRow}>
                <Text style={styles.avgBig}>
                  {professional.rating ? Number(professional.rating).toFixed(1) : '—'}
                </Text>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  {[5, 4, 3, 2, 1].map((star) => {
                    const pct = reviews.length
                      ? Math.round((reviewStats[star] / reviews.length) * 100)
                      : 0;
                    return (
                      <View key={star} style={styles.barRow}>
                        <Text style={styles.barLabel}>{star}★</Text>
                        <View style={styles.barTrack}>
                          <View style={[styles.barFill, { width: `${pct}%` }]} />
                        </View>
                        <Text style={styles.barPct}>{pct}%</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
              <Text style={styles.avgSub}>{reviews.length} reseñas en total</Text>
            </Card>

            {reviews.length === 0 && (
              <Card>
                <Text style={styles.empty}>Todavía no tiene reseñas.</Text>
              </Card>
            )}
            {reviews.map((r) => (
              <Card key={r.id}>
                <View style={styles.reviewHead}>
                  <Text style={styles.reviewFrom}>{r.from}</Text>
                  <Rating value={r.rating} />
                </View>
                {r.text ? <Text style={styles.reviewText}>{r.text}</Text> : null}
                <ReviewPhotos photos={r.photos} />
                {r.reply_text ? (
                  <View style={styles.reply}>
                    <Text style={styles.replyLabel}>Respuesta de {professional.name}</Text>
                    <Text style={styles.reviewText}>{r.reply_text}</Text>
                  </View>
                ) : null}
              </Card>
            ))}
          </>
        )}

        {tab === 'info' && (
          <>
            {professional.bio ? (
              <Card>
                <Text style={styles.infoLabel}>Sobre mí</Text>
                <Text style={styles.infoText}>{professional.bio}</Text>
              </Card>
            ) : null}
            <Card>
              <Text style={styles.infoLabel}>Zonas</Text>
              <Text style={styles.infoText}>{professional.barrio || 'A consultar'}</Text>
            </Card>
            {(professional.categories || []).length > 0 && (
              <Card>
                <Text style={styles.infoLabel}>Rubros</Text>
                <Text style={styles.infoText}>{professional.categories.join(' · ')}</Text>
              </Card>
            )}
            {!professional.bio && (
              <Text style={styles.empty}>Este profesional todavía no completó su info.</Text>
            )}
          </>
        )}

        {user?.id === professional.user_id && (
          <Text style={styles.self}>Este es tu perfil de profesional ✨</Text>
        )}
      </ScrollView>

      {/* Sticky bottom bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Text style={styles.fromPrice}>
          {minPrice > 0 ? `Desde ${gs(minPrice)}` : 'Consultá precios'}
        </Text>
        <PrimaryButton title="Reservar" onPress={() => goToBooking(null)} style={styles.bottomCta} />
      </View>
    </View>
  );
}

const CTA = { height: 52, borderRadius: 16 };

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.bg,
  },
  headerBtn: { padding: 6, minWidth: 40, alignItems: 'center' },
  headerBtnText: { fontSize: 32, color: colors.text, fontWeight: '400', lineHeight: 34 },
  headerRight: { flexDirection: 'row' },
  heart: { fontSize: 26, color: colors.muted },
  heartActive: { color: colors.danger },
  shareIcon: { fontSize: 24, color: colors.primary },
  link: { color: colors.primary, fontWeight: '700', fontSize: fontSize.md },

  inner: { padding: spacing.md },
  hero: { alignItems: 'center', marginBottom: spacing.md },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: { fontSize: 40, fontWeight: '800', color: colors.primary },
  name: { fontSize: fontSize.xl, fontWeight: '800', color: colors.text, textAlign: 'center' },
  verified: { color: colors.success, fontSize: fontSize.lg },
  rubro: { fontSize: fontSize.md, color: colors.primary, fontWeight: '700', marginTop: 4 },
  ratingLine: { fontSize: fontSize.md, color: colors.text, fontWeight: '700', marginTop: 6 },
  star: { color: colors.warning },
  ratingCount: { color: colors.muted, fontWeight: '400' },
  meta: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },

  cta: { ...CTA, marginTop: spacing.sm },
  secondary: { height: 52, borderRadius: 16, marginTop: spacing.sm },

  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: 4,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radius.button, alignItems: 'center' },
  tabActive: { backgroundColor: colors.light },
  tabText: { fontSize: fontSize.md, fontWeight: '600', color: colors.muted },
  tabTextActive: { color: colors.primary, fontWeight: '800' },

  section: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  svcRow: { flexDirection: 'row', alignItems: 'center' },
  svcName: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  svcPrice: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginTop: 4 },
  svcDetailLink: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '700', marginTop: 4 },
  chooseBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginLeft: spacing.sm,
  },
  chooseBtnText: { color: '#fff', fontWeight: '800', fontSize: fontSize.md },

  dayRow: { marginBottom: spacing.sm },
  dayChip: {
    backgroundColor: colors.card,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginRight: 8,
    alignItems: 'center',
    minWidth: 86,
  },
  dayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayChipText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
  dayChipSub: { fontSize: fontSize.xs, color: colors.muted, marginTop: 2 },
  dayChipTextActive: { color: '#fff' },
  timeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  timeChip: {
    backgroundColor: colors.light,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  timeChipText: { color: colors.primary, fontWeight: '800', fontSize: fontSize.md },
  timeChipFull: {
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  timeChipFullText: { color: colors.muted, fontWeight: '700', fontSize: fontSize.sm },
  timeChipFullSub: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '700', marginTop: 2 },

  avgRow: { flexDirection: 'row', alignItems: 'center' },
  avgBig: { fontSize: 44, fontWeight: '900', color: colors.text },
  barRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  barLabel: { fontSize: fontSize.xs, color: colors.muted, width: 28, fontWeight: '700' },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: colors.warning },
  barPct: { fontSize: fontSize.xs, color: colors.muted, width: 36, textAlign: 'right' },
  avgSub: { fontSize: fontSize.sm, color: colors.muted, marginTop: spacing.sm },
  reviewHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewFrom: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  reviewText: { fontSize: fontSize.sm, color: colors.text, marginTop: 6, lineHeight: 20 },
  reply: {
    marginTop: spacing.sm,
    backgroundColor: colors.light,
    borderRadius: radius.button,
    padding: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  replyLabel: { fontSize: fontSize.xs, fontWeight: '800', color: colors.primary, marginBottom: 4 },

  infoLabel: { fontSize: fontSize.sm, fontWeight: '800', color: colors.muted, marginBottom: 6 },
  infoText: { fontSize: fontSize.md, color: colors.text, lineHeight: 22 },

  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fromPrice: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, flex: 1 },
  bottomCta: { ...CTA, flex: 1.4 },

  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
  self: { textAlign: 'center', color: colors.primary, fontWeight: '700', marginTop: spacing.md },
});
