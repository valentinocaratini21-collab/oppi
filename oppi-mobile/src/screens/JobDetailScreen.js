import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs, label } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Detalle del trabajo (job): tarea, cliente, precio acordado, estado y fotos.
 * Acciones según estado y rol:
 *  - handyman: [Comenzar trabajo] (quoting→in_progress), [Marcar como completado]
 *    (in_progress→completed). Pago 100%: el cliente paga el total al finalizar
 *    (simulado por ahora).
 *  - cliente: cuando está completado → pago simulado (modal) + reseña mutua
 *    (estrellas + comentario, POST /api/reviews).
 *
 * ⚠️ Pago simulado: la integración real con la pasarela (PAYMENT_DRIVER del backend)
 * está pendiente de credenciales; el botón Pagar simula el cobro del total y lo deja
 * registrado en local. No hay botón muerto: cada acción llama a la API real.
 */
export function JobDetailScreen({ navigation, route }) {
  const { jobId } = route.params;
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [job, setJob] = useState(null);
  const [task, setTask] = useState(null);
  const [clientName, setClientName] = useState('');
  const [handymanName, setHandymanName] = useState('');
  const [hasReviewed, setHasReviewed] = useState(false);
  const [paid, setPaid] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState(false);

  // Modal de pago (cliente)
  const [payModal, setPayModal] = useState(false);
  const [paying, setPaying] = useState(false);
  // Reseña mutua
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [sendingReview, setSendingReview] = useState(false);

  const load = useCallback(async () => {
    try {
      const { job: j } = await api.job(jobId);
      setJob(j);
      try {
        const { task: t } = await api.task(j.task_id);
        setTask(t);
      } catch {
        setTask(null);
      }
      // Enriquecer nombres (GET /api/jobs/:id trae solo IDs).
      try {
        const { jobs: list } = await api.jobs();
        const row = (list || []).find((x) => x.id === j.id);
        if (row) {
          setClientName(row.client_name || '');
          setHandymanName(row.handyman_name || '');
        }
      } catch {
        // no bloquea
      }
      // ¿Ya dejé reseña en este trabajo?
      try {
        const { reviews } = await api.reviews({ job_id: j.id });
        setHasReviewed((reviews || []).some((r) => r.from_user === user?.id));
      } catch {
        setHasReviewed(false);
      }
      const p = await AsyncStorage.getItem(`oppi.job.paid.${j.id}`);
      setPaid(p === '1');
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar el trabajo.');
      navigation.goBack();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [jobId, user?.id, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  const isHandyman = user && job && job.handyman_id === user.id;
  const isClient = user && job && job.client_id === user.id;
  // Pago 100%: el cliente paga el total acordado al finalizar (simulado).
  const agreed = Number(job?.agreed_price_gs) || 0;
  const photos = task?.photos || [];

  async function transitionTo(status, confirmTitle, confirmMsg) {
    const doIt = async () => {
      setActing(true);
      try {
        const { job: updated } = await api.updateJob(jobId, { status });
        setJob(updated);
        if (status === 'completed') {
          Alert.alert(
            '¡Trabajo completado! 🎉',
            isHandyman
              ? 'El pago queda registrado para vos. Avisale al cliente que ya puede pagar y dejarte su reseña.'
              : 'El trabajo se marcó como completado.'
          );
        }
      } catch (e) {
        Alert.alert('No pudimos actualizar', e.message || 'Intentá de nuevo.');
      } finally {
        setActing(false);
      }
    };
    if (confirmTitle) {
      Alert.alert(confirmTitle, confirmMsg, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', style: 'destructive', onPress: doIt },
      ]);
    } else {
      doIt();
    }
  }

  async function simulatePay() {
    setPaying(true);
    try {
      // Pago simulado (integración real pendiente de credenciales de la pasarela).
      await new Promise((r) => setTimeout(r, 1500));
      await AsyncStorage.setItem(`oppi.job.paid.${jobId}`, '1');
      setPaid(true);
    } finally {
      setPaying(false);
    }
  }

  async function sendReview() {
    if (!stars) {
      Alert.alert('Faltan las estrellas', 'Elegí de 1 a 5 estrellas.');
      return;
    }
    const toUser = isClient ? job.handyman_id : job.client_id;
    setSendingReview(true);
    try {
      await api.createReview({
        job_id: jobId,
        to_user: toUser,
        rating: stars,
        text: comment.trim(),
      });
      setHasReviewed(true);
      setPayModal(false);
      Alert.alert('¡Gracias!', 'Tu reseña ayuda a que la comunidad confíe más.');
      await load();
    } catch (e) {
      Alert.alert('No pudimos enviar la reseña', e.message || 'Intentá de nuevo.');
    } finally {
      setSendingReview(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (!job) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>No encontramos ese trabajo.</Text>
      </View>
    );
  }

  const showStart = isHandyman && job.status === 'quoting';
  const showComplete = isHandyman && job.status === 'in_progress';
  const showPay = isClient && job.status === 'completed' && !paid;
  const showReviewCard =
    job.status === 'completed' && !hasReviewed && (isHandyman || (isClient && paid));

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Trabajo" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + 110 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <Card>
          <View style={styles.row}>
            <Text style={[styles.title, { flex: 1 }]}>{task?.title || `Trabajo #${job.id}`}</Text>
            <View style={[styles.statusBadge, job.status === 'completed' && styles.statusBadgeDone]}>
              <Text style={[styles.statusText, job.status === 'completed' && styles.statusTextDone]}>
                {label(job.status)}
              </Text>
            </View>
          </View>
          {task?.description ? <Text style={styles.desc}>{task.description}</Text> : null}
          <View style={styles.kvRow}>
            <Text style={styles.kvKey}>Cliente</Text>
            <Text style={styles.kvVal}>{clientName || '—'}</Text>
          </View>
          <View style={styles.kvRow}>
            <Text style={styles.kvKey}>Handyman</Text>
            <Text style={styles.kvVal}>{handymanName || '—'}</Text>
          </View>
          <View style={styles.kvRow}>
            <Text style={styles.kvKey}>Precio acordado</Text>
            <Text style={[styles.kvVal, styles.price]}>{gs(agreed)}</Text>
          </View>
        </Card>

        {photos.length > 0 && (
          <Card>
            <Text style={styles.section}>Fotos de la tarea</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photosRow}>
              {photos.map((p, i) => (
                <Image key={`${i}-${p}`} source={{ uri: p }} style={styles.photo} />
              ))}
            </ScrollView>
          </Card>
        )}

        {isHandyman && job.status === 'completed' && (
          <Card>
            <Text style={styles.tip}>💰 El pago ({gs(agreed)}) quedó registrado para vos. ¡Buen trabajo!</Text>
          </Card>
        )}

        {/* Reseña mutua: cada lado califica al otro cuando el trabajo está completo */}
        {showReviewCard && (
          <Card>
            <Text style={styles.section}>
              {isClient ? '¿Cómo te fue con el handyman?' : '¿Cómo te fue con el cliente?'}
            </Text>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((s) => (
                <TouchableOpacity key={s} onPress={() => setStars(s)} hitSlop={8}>
                  <Text style={[styles.star, s <= stars && styles.starOn]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={comment}
              onChangeText={setComment}
              placeholder="Contá cómo fue (opcional)…"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <PrimaryButton
              title="Enviar reseña"
              onPress={sendReview}
              loading={sendingReview}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        )}
      </ScrollView>

      {/* Bottom bar sticky con la acción principal según rol y estado */}
      {(showStart || showComplete || showPay) && (
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}>
          {showStart && (
            <PrimaryButton
              title="Comenzar trabajo"
              onPress={() => transitionTo('in_progress')}
              loading={acting}
              style={styles.cta}
            />
          )}
          {showComplete && (
            <PrimaryButton
              title="Marcar como completado"
              onPress={() =>
                transitionTo(
                  'completed',
                  '¿Terminaste el trabajo?',
                  'El cliente va a poder pagarte el total y ambos van a poder dejarse reseña.'
                )
              }
              loading={acting}
              style={styles.cta}
            />
          )}
          {showPay && (
            <PrimaryButton
              title={`Pagar ${gs(agreed)} (simulado)`}
              onPress={() => setPayModal(true)}
              style={styles.cta}
            />
          )}
        </View>
      )}

      {/* Modal de pago (cliente): paga el 100% al finalizar */}
      <Modal visible={payModal} transparent animationType="slide" onRequestClose={() => setPayModal(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + spacing.lg }]}>
            <TouchableOpacity style={styles.modalClose} onPress={() => setPayModal(false)} hitSlop={12}>
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>
            {!paid ? (
              <>
                <Text style={styles.modalTitle}>Pagar trabajo</Text>
                <View style={styles.payLine}>
                  <Text style={styles.kvKey}>Precio acordado</Text>
                  <Text style={styles.kvVal}>{gs(agreed)}</Text>
                </View>
                <Text style={styles.payTotal}>Pagás {gs(agreed)} al handyman</Text>
                <PrimaryButton
                  title={paying ? 'Procesando…' : `Pagar ${gs(agreed)} (simulado)`}
                  onPress={simulatePay}
                  loading={paying}
                  style={styles.cta}
                />
                <Text style={styles.payNote}>Pago simulado · la integración real con la pasarela está en camino.</Text>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>¡Pago listo! ✅</Text>
                <Text style={styles.modalSub}>Ahora dejale tu reseña al handyman:</Text>
                <View style={styles.stars}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <TouchableOpacity key={s} onPress={() => setStars(s)} hitSlop={8}>
                      <Text style={[styles.star, s <= stars && styles.starOn]}>★</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={[styles.input, styles.multiline]}
                  value={comment}
                  onChangeText={setComment}
                  placeholder="Contá cómo fue (opcional)…"
                  placeholderTextColor={colors.muted}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
                <PrimaryButton
                  title="Enviar reseña"
                  onPress={sendReview}
                  loading={sendingReview}
                  style={{ marginTop: spacing.md }}
                />
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  inner: { padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  desc: { fontSize: fontSize.md, color: colors.text, marginTop: 8, lineHeight: 22 },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  kvKey: { fontSize: fontSize.sm, color: colors.muted },
  kvVal: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
  price: { fontSize: fontSize.md, color: colors.primary, fontWeight: '800' },
  statusBadge: { backgroundColor: colors.light, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10, marginLeft: spacing.sm },
  statusBadgeDone: { backgroundColor: '#E6F6EC' },
  statusText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  statusTextDone: { color: colors.success },
  section: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  photosRow: { marginTop: spacing.xs },
  photo: { width: 120, height: 120, borderRadius: radius.button, marginRight: spacing.sm, backgroundColor: colors.light },
  tip: { fontSize: fontSize.sm, color: colors.text, lineHeight: 20 },
  muted: { color: colors.muted, fontSize: fontSize.sm },
  stars: { flexDirection: 'row', gap: 6, marginVertical: spacing.sm },
  star: { fontSize: 34, color: colors.border },
  starOn: { color: '#F5A623' },
  input: {
    backgroundColor: colors.bg, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 12, fontSize: fontSize.md, color: colors.text,
  },
  multiline: { minHeight: 80, marginTop: spacing.sm },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border,
    paddingHorizontal: spacing.md, paddingTop: spacing.md,
  },
  cta: { height: 52, borderRadius: 16, justifyContent: 'center' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg,
  },
  modalClose: { position: 'absolute', top: spacing.md, right: spacing.md, zIndex: 1 },
  modalCloseText: { fontSize: fontSize.lg, color: colors.muted },
  modalTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  modalSub: { fontSize: fontSize.sm, color: colors.muted, marginBottom: spacing.xs },
  payLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  payTotal: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginVertical: spacing.md },
  payNote: { fontSize: fontSize.xs, color: colors.muted, textAlign: 'center', marginTop: spacing.sm },
});
