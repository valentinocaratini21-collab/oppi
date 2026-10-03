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
  Modal,
  TextInput,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { CancelPolicyBanner } from '../components/CancelPolicyBanner';
import { gs, label, shortDate } from '../utils';
import { pickAndUpload } from '../utils/photos';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Mis reservas: bookings (clientes/profesionales) + jobs handyman.
 * - Pestañas Próximas | Pasadas (además de los filtros por estado, intactos).
 * - Cada reserva próxima muestra su recordatorio.
 * - Post-servicio con notificación `review_request` → botón "Dejar reseña"
 *   (con fotos, máx 3).
 * - Cancelar: llama a cancel-preview ANTES de confirmar y muestra
 *   "Se te devuelven Gs. X" / "Perdés el pago de Gs. X".
 * - Reprogramar (cliente, reserva confirmada con profesional individual):
 *   selector de día/hora → confirmación "Tu pago se mantiene".
 * - "No vino": el cliente marca "El profesional no vino" y el profesional
 *   "El cliente no vino", con la consecuencia económica en la confirmación.
 * - "Voy en camino 🛵": el profesional lo marca el día del servicio; el
 *   cliente ve el banner cuando `en_route_at` está seteado.
 */
const STATUS_FILTERS = [
  { value: '', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'confirmed', label: 'Confirmadas' },
  { value: 'completed', label: 'Realizadas' },
  { value: 'cancelled', label: 'Canceladas' },
];

const STATUS_COLORS = {
  pending: colors.warning,
  confirmed: colors.primary,
  completed: colors.success,
  cancelled: colors.muted,
  no_show_client: colors.danger,
  no_show_pro: colors.danger,
};

const TABS = [
  { id: 'upcoming', label: 'Próximas' },
  { id: 'past', label: 'Pasadas' },
];

const UPCOMING = ['pending', 'confirmed'];
const PAST = ['completed', 'cancelled', 'no_show_client', 'no_show_pro'];

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function BookingsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState('upcoming');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState(null);
  // Notificaciones review_request sin leer → habilitan "Dejar reseña".
  const [reviewRequest, setReviewRequest] = useState(false);

  // Modal de reseña
  const [reviewFor, setReviewFor] = useState(null);
  const [stars, setStars] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [reviewPhotos, setReviewPhotos] = useState([]); // [{ url, key }]
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [sendingReview, setSendingReview] = useState(false);

  // Modal de reprogramación
  const [reschedFor, setReschedFor] = useState(null);
  const [reschedDates, setReschedDates] = useState([]);
  const [reschedByDate, setReschedByDate] = useState({});
  const [reschedDate, setReschedDate] = useState(null);
  const [reschedSlot, setReschedSlot] = useState(null);
  const [reschedLoading, setReschedLoading] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ bookings: b }, { jobs: j }, notifs] = await Promise.all([
        api.bookings(filter ? { status: filter } : {}),
        api.jobs(),
        api.notifications({ unread: 1 }).catch(() => ({ notifications: [] })),
      ]);
      setBookings(b);
      setJobs(j);
      setReviewRequest((notifs.notifications || []).some((n) => n.type === 'review_request'));
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar tus reservas.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  // Desde BookingDetail → "Reprogramar": llega { rescheduleFor: bookingId }
  // y abrimos el modal de reprogramación directamente.
  const reschedParam = route.params?.rescheduleFor;
  useEffect(() => {
    if (reschedParam && bookings.length) {
      const target = bookings.find((x) => String(x.id) === String(reschedParam));
      if (target) {
        openReschedule(target);
        navigation.setParams({ rescheduleFor: null });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reschedParam, bookings]);

  // ¿Soy el cliente de esta reserva? (si no, la veo como profesional)
  function amClient(b) {
    if (user?.id && b.client_id) return String(b.client_id) === String(user.id);
    return true;
  }

  // --- Reprogramar: modal con turnos libres del profesional ---
  async function openReschedule(b) {
    setReschedFor(b);
    setReschedDates([]);
    setReschedByDate({});
    setReschedDate(null);
    setReschedSlot(null);
    setReschedLoading(true);
    try {
      const { slots } = await api.slots({ professional_id: b.pro_id });
      const grouped = {};
      for (const s of slots || []) {
        if (s.status !== 'free') continue;
        if (s.date < todayIso()) continue;
        if (!grouped[s.date]) grouped[s.date] = [];
        grouped[s.date].push(s);
      }
      const sorted = Object.keys(grouped).sort();
      setReschedByDate(grouped);
      setReschedDates(sorted);
      if (sorted.length) setReschedDate(sorted[0]);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar los turnos libres.');
      setReschedFor(null);
    } finally {
      setReschedLoading(false);
    }
  }

  async function confirmReschedule() {
    if (!reschedFor || !reschedSlot) return;
    setRescheduling(true);
    try {
      await api.rescheduleBooking(reschedFor.id, reschedSlot.id);
      setReschedFor(null);
      setReschedSlot(null);
      Alert.alert(
        '¡Turno reprogramado! 📅',
        `Tu pago de ${gs(reschedFor.total_gs)} se mantiene. ` +
          `Nuevo turno: ${shortDate(reschedSlot.date)} ${String(reschedSlot.time).slice(0, 5)}.`
      );
      await load();
    } catch (e) {
      Alert.alert('No pudimos reprogramar', e.message || 'Intentá con otro turno.');
    } finally {
      setRescheduling(false);
    }
  }

  // --- Voy en camino ---
  async function markEnRoute(b) {
    setActingId(b.id);
    try {
      await api.markEnRoute(b.id);
      Alert.alert('¡Avisado! 🛵', 'El cliente ya ve que vas en camino.');
      await load();
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos avisar.');
    } finally {
      setActingId(null);
    }
  }

  // --- Reseña con fotos ---
  function openReview(b) {
    setReviewFor(b);
    setStars(5);
    setReviewText('');
    setReviewPhotos([]);
  }

  async function addReviewPhoto() {
    if (reviewPhotos.length >= 3) return;
    setUploadingPhoto(true);
    try {
      const res = await pickAndUpload({ quality: 0.7 });
      if (!res.canceled) {
        setReviewPhotos((prev) => [...prev, { url: res.file.url, key: res.file.key || res.file.url }]);
      }
    } catch (e) {
      Alert.alert('No pudimos subir la foto', e.message || 'Intentá de nuevo.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function submitReview() {
    if (!reviewFor) return;
    if (!reviewFor.pro_id) {
      Alert.alert('Ups', 'Solo podés dejar reseña en reservas con profesionales por ahora.');
      return;
    }
    setSendingReview(true);
    try {
      // createReview pide to_user (el user id del profesional reseñado).
      const { professional } = await api.professional(reviewFor.pro_id);
      await api.createReview({
        booking_id: reviewFor.id,
        to_user: professional.user_id,
        rating: stars,
        text: reviewText.trim(),
        photos: reviewPhotos.map((p) => p.url),
      });
      Alert.alert('¡Gracias! ⭐', 'Tu reseña ya quedó publicada.');
      setReviewFor(null);
      await load();
    } catch (e) {
      Alert.alert('No pudimos publicar la reseña', e.message || 'Intentá de nuevo.');
    } finally {
      setSendingReview(false);
    }
  }

  function whenLine(b) {
    if (b.slot_date) {
      return `${shortDate(b.slot_date)}${b.slot_time ? ` · ${b.slot_time.slice(0, 5)}` : ''}`;
    }
    return null;
  }

  const visible = bookings.filter((b) =>
    tab === 'upcoming' ? UPCOMING.includes(b.status) : PAST.includes(b.status)
  );

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Mis reservas" />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {/* Pestañas Próximas | Pasadas */}
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

        <View style={styles.chips}>
          {STATUS_FILTERS.map((f) => (
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

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : (
          <>
            {visible.length === 0 && (
              <Card>
                <Text style={styles.empty}>
                  {tab === 'upcoming'
                    ? 'No tenés reservas próximas. ¡Buscá un profesional y reservá!'
                    : 'Todavía no tenés reservas pasadas.'}
                </Text>
              </Card>
            )}
            {visible.map((b) => {
              const client = amClient(b);
              const isToday = b.slot_date === todayIso();
              return (
                <Card key={`b-${b.id}`}>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.title}>{b.service_name}</Text>
                      {client && b.pro_name ? <Text style={styles.meta}>Con {b.pro_name}</Text> : null}
                      {!client && b.client_name ? <Text style={styles.meta}>Cliente: {b.client_name}</Text> : null}
                      {b.business_name ? <Text style={styles.meta}>🏪 {b.business_name}</Text> : null}
                      {whenLine(b) ? <Text style={styles.when}>🗓 {whenLine(b)}</Text> : null}
                      <Text style={styles.meta}>Total: {gs(b.total_gs)}</Text>
                      <TouchableOpacity
                        onPress={() => navigation.navigate('BookingDetail', { bookingId: b.id })}
                        hitSlop={8}
                      >
                        <Text style={styles.detailLink}>Ver detalle →</Text>
                      </TouchableOpacity>
                      {b.credit_applied_gs > 0 && (
                        <Text style={styles.meta}>Crédito aplicado: {gs(b.credit_applied_gs)}</Text>
                      )}
                      {(b.discount_gs > 0 || b.coupon_code) && (
                        <Text style={styles.meta}>
                          Cupón{b.coupon_code ? ` ${b.coupon_code}` : ''}: −{gs(b.discount_gs)}
                        </Text>
                      )}
                      {tab === 'upcoming' && UPCOMING.includes(b.status) && (
                        <Text style={styles.reminder}>
                          ⏰ {b.reminder || 'Te avisamos el día anterior a las 18:00'}
                        </Text>
                      )}
                    </View>
                    <View style={[styles.badge, { backgroundColor: STATUS_COLORS[b.status] || colors.muted }]}>
                      <Text style={styles.badgeText}>{label(b.status)}</Text>
                    </View>
                  </View>

                  {/* Banner: el profesional va en camino */}
                  {client && b.en_route_at && tab === 'upcoming' && (
                    <View style={styles.enRouteBanner}>
                      <Text style={styles.enRouteText}>🛵 ¡Va en camino! Te llega en un rato.</Text>
                    </View>
                  )}
                  {!client && b.en_route_at && (
                    <Text style={styles.enRouteNote}>🛵 Avisaste que vas en camino.</Text>
                  )}

                  {/* Banner: política de cancelación (comodines) */}
                  {client && b.status === 'confirmed' && tab === 'upcoming' && (
                    <CancelPolicyBanner bookingId={b.id} />
                  )}

                  <View style={styles.actions}>
                    {client && (b.status === 'pending' || b.status === 'confirmed') && (
                      <PrimaryButton
                        title="Cancelar"
                        variant="danger"
                        loading={actingId === b.id}
                        onPress={() =>
                          navigation.navigate('CancelBooking', {
                            bookingId: b.id,
                            role: 'cliente',
                            serviceName: b.service_name,
                          })
                        }
                        style={styles.actionBtn}
                      />
                    )}
                    {/* Cancelar: profesional (motivo obligatorio en la pantalla) */}
                    {!client && (b.status === 'pending' || b.status === 'confirmed') && (
                      <PrimaryButton
                        title="Cancelar"
                        variant="danger"
                        loading={actingId === b.id}
                        onPress={() =>
                          navigation.navigate('CancelBooking', {
                            bookingId: b.id,
                            role: 'pro',
                            serviceName: b.service_name,
                          })
                        }
                        style={styles.actionBtn}
                      />
                    )}
                    {/* Reprogramar: solo cliente, reserva confirmada con profesional individual */}
                    {client && b.status === 'confirmed' && b.pro_id && (
                      <PrimaryButton
                        title="Reprogramar"
                        variant="secondary"
                        onPress={() => openReschedule(b)}
                        style={styles.actionBtn}
                      />
                    )}
                    {b.status === 'completed' && reviewRequest && client && (
                      <PrimaryButton
                        title="⭐ Dejar reseña"
                        variant="ghost"
                        onPress={() => openReview(b)}
                        style={styles.actionBtn}
                      />
                    )}
                  </View>

                  {/* No-show: pasado, según el rol → pantalla con promesas */}
                  {client && tab === 'past' && b.status === 'completed' && (
                    <PrimaryButton
                      title="😕 El profesional no vino"
                      variant="ghost"
                      onPress={() =>
                        navigation.navigate('ReportNoShow', {
                          bookingId: b.id,
                          asRole: 'cliente',
                          serviceName: b.service_name,
                          otherName: b.pro_name,
                        })
                      }
                      style={styles.noShowBtn}
                    />
                  )}
                  {!client && tab === 'past' && b.status === 'completed' && (
                    <PrimaryButton
                      title="🚫 El cliente no vino"
                      variant="ghost"
                      onPress={() =>
                        navigation.navigate('ReportNoShow', {
                          bookingId: b.id,
                          asRole: 'pro',
                          serviceName: b.service_name,
                          otherName: b.client_name,
                        })
                      }
                      style={styles.noShowBtn}
                    />
                  )}

                  {/* Voy en camino: profesional, el día del servicio */}
                  {!client && b.status === 'confirmed' && isToday && !b.en_route_at && (
                    <>
                      <PrimaryButton
                        title="Voy en camino 🛵"
                        loading={actingId === b.id}
                        onPress={() => markEnRoute(b)}
                        style={styles.enRouteBtn}
                      />
                      <Text style={styles.enRoutePolicyNote}>
                        Avisá cuando salgas: si vas en camino y llegás, el turno no cuenta como
                        no-show y tu cumplimiento queda protegido.
                      </Text>
                    </>
                  )}
                </Card>
              );
            })}

            {tab === 'upcoming' && jobs.length > 0 && (
              <>
                <Text style={styles.section}>Mis trabajos (handyman)</Text>
                {jobs.map((j) => (
                  <Card key={`j-${j.id}`}>
                    <View style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.title}>{j.task_title}</Text>
                        <Text style={styles.meta}>{j.client_name} ↔ {j.handyman_name}</Text>
                        <Text style={styles.meta}>Acordado: {gs(j.agreed_price_gs)}</Text>
                      </View>
                      <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                        <Text style={styles.badgeText}>{label(j.status)}</Text>
                      </View>
                    </View>
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Modal: dejar reseña */}
      <Modal
        visible={!!reviewFor}
        animationType="slide"
        transparent
        onRequestClose={() => setReviewFor(null)}
      >
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Dejá tu reseña</Text>
              <TouchableOpacity onPress={() => setReviewFor(null)} hitSlop={10}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>
              ¿Cómo te fue con {reviewFor?.pro_name || 'el profesional'}?
            </Text>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity key={n} onPress={() => setStars(n)} hitSlop={8}>
                  <Text style={[styles.star, n <= stars && styles.starOn]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.reviewInput}
              value={reviewText}
              onChangeText={setReviewText}
              placeholder="Contá cómo fue el servicio (opcional)…"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={4}
            />

            <Text style={styles.photosLabel}>Fotos (opcional, máx. 3)</Text>
            <View style={styles.photosRow}>
              {reviewPhotos.map((p) => (
                <View key={p.key} style={styles.thumbWrap}>
                  <Image source={{ uri: p.url }} style={styles.thumb} />
                  <TouchableOpacity
                    style={styles.thumbRemove}
                    onPress={() => setReviewPhotos((prev) => prev.filter((x) => x.key !== p.key))}
                    hitSlop={10}
                  >
                    <Text style={styles.thumbRemoveText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {reviewPhotos.length < 3 && (
                <TouchableOpacity
                  style={styles.addPhoto}
                  onPress={addReviewPhoto}
                  disabled={uploadingPhoto}
                  activeOpacity={0.8}
                >
                  {uploadingPhoto ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Text style={styles.addPhotoText}>📷{'\n'}Agregar</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

            <PrimaryButton
              title="Enviar reseña"
              loading={sendingReview}
              onPress={submitReview}
              style={styles.modalCta}
            />
          </View>
        </View>
      </Modal>

      {/* Modal: reprogramar */}
      <Modal
        visible={!!reschedFor}
        animationType="slide"
        transparent
        onRequestClose={() => setReschedFor(null)}
      >
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Reprogramar turno</Text>
              <TouchableOpacity onPress={() => setReschedFor(null)} hitSlop={10}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>
              {reschedFor?.service_name}
              {reschedFor ? ` · Actual: ${reschedFor.slot_date ? shortDate(reschedFor.slot_date) : ''} ${reschedFor.slot_time ? reschedFor.slot_time.slice(0, 5) : ''}` : ''}
            </Text>

            {reschedLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
            ) : reschedDates.length === 0 ? (
              <Text style={styles.empty}>
                No hay turnos libres por ahora. Probá de nuevo en un rato.
              </Text>
            ) : (
              <>
                <Text style={styles.photosLabel}>Elegí el día</Text>
                <View style={styles.dayChips}>
                  {reschedDates.map((d) => (
                    <TouchableOpacity
                      key={d}
                      style={[styles.dayChip, reschedDate === d && styles.dayChipActive]}
                      onPress={() => {
                        setReschedDate(d);
                        setReschedSlot(null);
                      }}
                    >
                      <Text style={[styles.dayChipText, reschedDate === d && styles.dayChipTextActive]}>
                        {shortDate(d)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {reschedDate && (
                  <>
                    <Text style={styles.photosLabel}>Elegí la hora</Text>
                    <View style={styles.dayChips}>
                      {(reschedByDate[reschedDate] || []).map((s) => (
                        <TouchableOpacity
                          key={s.id}
                          style={[styles.dayChip, reschedSlot?.id === s.id && styles.dayChipActive]}
                          onPress={() => setReschedSlot(s)}
                        >
                          <Text style={[styles.dayChipText, reschedSlot?.id === s.id && styles.dayChipTextActive]}>
                            {String(s.time).slice(0, 5)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
              </>
            )}

            <Text style={styles.payNote}>
              Tu pago se mantiene: no pagás nada de más.
            </Text>
            <PrimaryButton
              title="Confirmar reprogramación"
              loading={rescheduling}
              disabled={!reschedSlot}
              onPress={confirmReschedule}
              style={styles.modalCta}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  tabs: {
    flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.card,
    padding: 4, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radius.button, alignItems: 'center' },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: fontSize.md, fontWeight: '700', color: colors.muted },
  tabTextActive: { color: '#fff' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  chip: {
    backgroundColor: colors.card, borderRadius: 999, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 8, paddingHorizontal: 12,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  meta: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  when: { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary, marginTop: 4 },
  reminder: { fontSize: fontSize.sm, color: colors.muted, marginTop: 6, fontStyle: 'italic' },
  badge: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  badgeText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '800' },
  actions: { flexDirection: 'row', marginTop: spacing.sm, gap: 8 },
  actionBtn: { flex: 1, paddingVertical: 10, minHeight: 40 },
  noShowBtn: { marginTop: spacing.sm, minHeight: 44 },
  enRouteBtn: { marginTop: spacing.sm, minHeight: 48 },
  section: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
  enRouteBanner: {
    backgroundColor: '#E6F7ED', borderRadius: radius.button,
    padding: spacing.sm, marginTop: spacing.sm,
  },
  enRouteText: { color: colors.success, fontWeight: '800', fontSize: fontSize.sm, textAlign: 'center' },
  enRouteNote: { color: colors.muted, fontSize: fontSize.sm, marginTop: spacing.sm, fontStyle: 'italic' },
  enRoutePolicyNote: { color: colors.muted, fontSize: fontSize.xs, marginTop: spacing.xs, lineHeight: 18 },
  detailLink: { color: colors.primary, fontWeight: '700', fontSize: fontSize.sm, marginTop: spacing.xs },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, maxHeight: '90%',
  },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  modalTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  modalClose: { fontSize: 20, color: colors.muted, padding: 4 },
  modalSub: { fontSize: fontSize.sm, color: colors.muted, marginBottom: spacing.sm },
  stars: { flexDirection: 'row', justifyContent: 'center', marginVertical: spacing.sm },
  star: { fontSize: 40, color: colors.border, marginHorizontal: 4 },
  starOn: { color: colors.warning },
  reviewInput: {
    backgroundColor: colors.bg, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, fontSize: fontSize.md, color: colors.text,
    minHeight: 100, textAlignVertical: 'top',
  },
  photosLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: 8 },
  photosRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  thumbWrap: { position: 'relative' },
  thumb: { width: 88, height: 88, borderRadius: 12 },
  thumbRemove: {
    position: 'absolute', top: -8, right: -8, width: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  thumbRemoveText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  addPhoto: {
    width: 88, height: 88, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed',
    borderColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.light,
  },
  addPhotoText: { color: colors.primary, fontWeight: '700', fontSize: fontSize.sm, textAlign: 'center' },
  modalCta: { height: 52, borderRadius: 16, marginTop: spacing.md },
  dayChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayChip: {
    backgroundColor: colors.bg, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 14,
  },
  dayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayChipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  dayChipTextActive: { color: '#fff' },
  payNote: {
    fontSize: fontSize.sm, color: colors.success, fontWeight: '700',
    marginTop: spacing.md, lineHeight: 20,
  },
});
