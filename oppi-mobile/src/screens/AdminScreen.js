import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  Image,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { Card } from '../components/Card';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Panel de administración básico (ruta "Admin").
 * SOLO para usuarios admin: la ruta se registra en el navigator solo si
 * `user.is_admin` (o role 'admin') y el menú del perfil solo la muestra en
 * ese caso. Lo principal vive en la web; acá lo esencial operativo:
 *  - Verificaciones pendientes (documentos como imágenes): aprobar / rechazar
 *    con motivo.
 *  - Suspender / reactivar usuarios (búsqueda por ID + confirmación).
 */
const STAT_DEFS = [
  { label: 'Usuarios', keys: ['users', 'users_total', 'total_users'] },
  { label: 'Profesionales', keys: ['professionals', 'pros', 'professionals_total'] },
  { label: 'Negocios', keys: ['businesses', 'businesses_total'] },
  { label: 'Reservas', keys: ['bookings', 'bookings_total', 'total_bookings'] },
  { label: 'Verificaciones pendientes', keys: ['pending_verifications', 'verifications_pending'] },
];

function pickStat(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'number') return v;
  }
  return null;
}

function fmtDate(s) {
  try {
    return new Date(String(s).replace(' ', 'T')).toLocaleDateString('es-PY', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function AdminScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isAdmin = user?.is_admin === true || user?.is_admin === 1 || user?.role === 'admin';

  const [overview, setOverview] = useState(null);
  const [verifications, setVerifications] = useState([]);
  const [modQueue, setModQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState(null);

  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const [userId, setUserId] = useState('');
  const [suspending, setSuspending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ov, ver, mod] = await Promise.all([
        api.adminOverview().catch(() => ({})),
        api.adminVerifications().catch(() => ({ verifications: [] })),
        api.adminModeration().catch(() => ({ queue: [] })),
      ]);
      setOverview(ov?.stats || ov?.overview || ov || {});
      const list = ver?.verifications || ver?.items || [];
      setVerifications(Array.isArray(list) ? list : []);
      const mq = mod?.queue || [];
      setModQueue(Array.isArray(mq) ? mq : []);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar el panel.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin, load]);

  if (!isAdmin) {
    return (
      <View style={styles.wrap}>
        <ScreenHeader title="Administración" onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Text style={styles.noAccess}>No tenés acceso a esta sección.</Text>
        </View>
      </View>
    );
  }

  async function decide(v, decision, reason) {
    setActingId(v.id);
    try {
      await api.verifyDecision(v.id, { decision, reason: reason || undefined });
      setVerifications((prev) => prev.filter((x) => x.id !== v.id));
      Alert.alert(
        'Listo',
        decision === 'approved' ? 'Verificación aprobada.' : 'Verificación rechazada.'
      );
    } catch (e) {
      Alert.alert('No se pudo guardar la decisión', e.message || 'Intentá de nuevo.');
    } finally {
      setActingId(null);
      if (decision === 'rejected') {
        setRejectFor(null);
        setRejectReason('');
        setRejecting(false);
      }
    }
  }

  // Equipo IA: decidir sobre una reseña retenida por el moderador.
  async function decideMod(m, decision) {
    const key = `mod:${m.id}`;
    setActingId(key);
    try {
      await api.decideModeration(m.id, decision);
      setModQueue((prev) => prev.filter((x) => x.id !== m.id));
      Alert.alert('Listo', decision === 'approve' ? 'Reseña publicada.' : 'Reseña rechazada.');
    } catch (e) {
      Alert.alert('No se pudo guardar la decisión', e.message || 'Intentá de nuevo.');
    } finally {
      setActingId(null);
    }
  }

  function askApprove(v) {
    Alert.alert(
      'Aprobar verificación',
      `¿Aprobar la verificación de ${v.user_name || v.name || 'este usuario'}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Aprobar', onPress: () => decide(v, 'approved') },
      ]
    );
  }

  function askReject(v) {
    setRejectFor(v);
    setRejectReason('');
  }

  async function submitReject() {
    if (!rejectReason.trim()) {
      Alert.alert('Falta el motivo', 'Contanos por qué se rechaza, para avisarle al usuario.');
      return;
    }
    setRejecting(true);
    await decide(rejectFor, 'rejected', rejectReason.trim());
  }

  function confirmSuspend() {
    const id = userId.trim();
    if (!id) {
      Alert.alert('Falta el usuario', 'Escribí el ID del usuario a suspender.');
      return;
    }
    Alert.alert(
      'Suspender usuario',
      `¿Suspender la cuenta del usuario #${id}? No va a poder reservar ni recibir reservas hasta que lo reactives.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Suspender',
          style: 'destructive',
          onPress: async () => {
            setSuspending(true);
            try {
              await api.suspendUser(id);
              setUserId('');
              Alert.alert('Listo', `El usuario #${id} quedó suspendido.`);
            } catch (e) {
              Alert.alert('No se pudo suspender', e.message || 'Intentá de nuevo.');
            } finally {
              setSuspending(false);
            }
          },
        },
      ]
    );
  }

  function confirmUnsuspend() {
    const id = userId.trim();
    if (!id) {
      Alert.alert('Falta el usuario', 'Escribí el ID del usuario a reactivar.');
      return;
    }
    Alert.alert('Reactivar usuario', `¿Reactivar la cuenta del usuario #${id}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Reactivar',
        onPress: async () => {
          setSuspending(true);
          try {
            await api.unsuspendUser(id);
            setUserId('');
            Alert.alert('Listo', `El usuario #${id} quedó reactivado.`);
          } catch (e) {
            Alert.alert('No se pudo reactivar', e.message || 'Intentá de nuevo.');
          } finally {
            setSuspending(false);
          }
        },
      },
    ]);
  }

  const stats = STAT_DEFS.map((d) => ({
    label: d.label,
    value: pickStat(overview, d.keys),
  })).filter((s) => s.value !== null);

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Administración" onBack={() => navigation.goBack()} />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
        >
          {/* Resumen */}
          {stats.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Resumen</Text>
              <View style={styles.statsGrid}>
                {stats.map((s) => (
                  <Card key={s.label} style={styles.stat}>
                    <Text style={styles.statValue}>{s.value}</Text>
                    <Text style={styles.statLabel}>{s.label}</Text>
                  </Card>
                ))}
              </View>
            </>
          )}

          {/* Verificaciones pendientes */}
          <Text style={styles.sectionTitle}>
            Verificaciones pendientes ({verifications.length})
          </Text>
          {verifications.length === 0 ? (
            <Card>
              <Text style={styles.empty}>No hay verificaciones pendientes. 🎉</Text>
            </Card>
          ) : (
            verifications.map((v) => {
              const docs = v.documents || v.document_urls || v.photos || [];
              const busy = actingId === v.id;
              return (
                <Card key={v.id} style={styles.verCard}>
                  <View style={styles.verHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.verName}>
                        {v.user_name || v.name || v.business_name || `Solicitud #${v.id}`}
                      </Text>
                      {!!(v.user_email || v.email) && (
                        <Text style={styles.verSub}>{v.user_email || v.email}</Text>
                      )}
                      {!!v.created_at && <Text style={styles.verSub}>{fmtDate(v.created_at)}</Text>}
                      {!!v.kind && <Text style={styles.verKind}>{v.kind}</Text>}
                    </View>
                  </View>
                  {docs.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.docs}>
                      {docs.map((uri, i) => (
                        <Image
                          key={i}
                          source={{ uri: typeof uri === 'string' ? uri : uri.url }}
                          style={styles.docImg}
                          resizeMode="cover"
                        />
                      ))}
                    </ScrollView>
                  )}
                  {/* Equipo IA: pre-chequeo del verificador */}
                  {!!v.precheck && typeof v.precheck.score === 'number' && (
                    <View style={styles.precheckBox}>
                      <View style={styles.precheckHead}>
                        <Text style={styles.precheckTitle}>🤖 Pre-chequeo automático</Text>
                        <Text style={[
                          styles.precheckScore,
                          v.precheck.score >= 80 ? styles.precheckOk
                            : v.precheck.score >= 50 ? styles.precheckWarn
                            : styles.precheckBad,
                        ]}>
                          {v.precheck.score}/100
                        </Text>
                      </View>
                      {(v.precheck.flags || []).map((f, i) => (
                        <Text key={i} style={styles.precheckFlag}>
                          {f.severity === 'alta' ? '🔴' : f.severity === 'media' ? '🟡' : '🔵'} {f.message || f.code}
                        </Text>
                      ))}
                      {!(v.precheck.flags || []).length && (
                        <Text style={styles.precheckFlag}>Sin observaciones. Nada se aprueba solo.</Text>
                      )}
                    </View>
                  )}
                  <View style={styles.verActions}>
                    <TouchableOpacity
                      style={[styles.approveBtn, busy && styles.disabled]}
                      onPress={() => askApprove(v)}
                      disabled={busy}
                    >
                      <Text style={styles.approveText}>{busy ? '…' : 'Aprobar'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.rejectBtn, busy && styles.disabled]}
                      onPress={() => askReject(v)}
                      disabled={busy}
                    >
                      <Text style={styles.rejectText}>{busy ? '…' : 'Rechazar'}</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              );
            })
          )}

          {/* Equipo IA: cola de moderación de reseñas */}
          <Text style={styles.sectionTitle}>
            Reseñas retenidas ({modQueue.length})
          </Text>
          {modQueue.length === 0 ? (
            <Card>
              <Text style={styles.empty}>Nada retenido por el moderador. 🎉</Text>
            </Card>
          ) : (
            modQueue.map((m) => {
              const busy = actingId === `mod:${m.id}`;
              return (
                <Card key={m.id} style={styles.verCard}>
                  <Text style={styles.verName}>
                    {'⭐'.repeat(m.rating || 0)}{'☆'.repeat(5 - (m.rating || 0))}
                  </Text>
                  <Text style={{ marginVertical: 6 }}>{m.text || '(sin texto)'}</Text>
                  {!!m.from_name && <Text style={styles.verSub}>De: {m.from_name}</Text>}
                  {!!m.to_name && <Text style={styles.verSub}>Para: {m.to_name}</Text>}
                  {!!m.moderation_reason && (
                    <Text style={styles.verSub}>🤖 Motivo: {m.moderation_reason}</Text>
                  )}
                  <View style={styles.verActions}>
                    <TouchableOpacity
                      style={[styles.approveBtn, busy && styles.disabled]}
                      onPress={() => decideMod(m, 'approve')}
                      disabled={busy}
                    >
                      <Text style={styles.approveText}>{busy ? '…' : 'Publicar'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.rejectBtn, busy && styles.disabled]}
                      onPress={() => decideMod(m, 'reject')}
                      disabled={busy}
                    >
                      <Text style={styles.rejectText}>{busy ? '…' : 'Rechazar'}</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              );
            })
          )}

          {/* Suspender / reactivar usuarios */}
          <Text style={styles.sectionTitle}>Suspender o reactivar usuario</Text>
          <Card>
            <Text style={styles.fieldLabel}>ID del usuario</Text>
            <TextInput
              style={styles.input}
              value={userId}
              onChangeText={setUserId}
              placeholder="Ej. 123"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
            />
            <View style={styles.suspendRow}>
              <TouchableOpacity
                style={[styles.suspendBtn, suspending && styles.disabled]}
                onPress={confirmSuspend}
                disabled={suspending}
              >
                <Text style={styles.suspendText}>{suspending ? '…' : 'Suspender'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.unsuspendBtn, suspending && styles.disabled]}
                onPress={confirmUnsuspend}
                disabled={suspending}
              >
                <Text style={styles.unsuspendText}>{suspending ? '…' : 'Reactivar'}</Text>
              </TouchableOpacity>
            </View>
          </Card>
        </ScrollView>
      )}

      {/* Modal: motivo de rechazo */}
      <Modal
        visible={!!rejectFor}
        animationType="slide"
        transparent
        onRequestClose={() => setRejectFor(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBg}
        >
          <View style={[styles.modal, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Rechazar verificación</Text>
              <TouchableOpacity onPress={() => setRejectFor(null)} hitSlop={12}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Motivo (se le avisa al usuario)</Text>
            <TextInput
              style={[styles.input, styles.reasonInput]}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="Ej. El documento está borroso, subilo de nuevo."
              placeholderTextColor={colors.muted}
              multiline
            />
            <PrimaryButton
              title="Rechazar con este motivo"
              variant="danger"
              onPress={submitReject}
              loading={rejecting}
              disabled={rejecting}
              style={styles.modalCta}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  noAccess: { fontSize: fontSize.md, color: colors.muted, textAlign: 'center' },

  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: { flex: 1, minWidth: 100, alignItems: 'center', paddingVertical: spacing.md },
  statValue: { fontSize: fontSize.xl, fontWeight: '900', color: colors.primary },
  statLabel: { fontSize: fontSize.xs, color: colors.muted, marginTop: 4, textAlign: 'center' },

  empty: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  verCard: { marginBottom: spacing.sm },
  verHead: { flexDirection: 'row', alignItems: 'flex-start' },
  verName: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  verSub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  verKind: {
    fontSize: fontSize.xs,
    color: colors.primary,
    fontWeight: '700',
    marginTop: 4,
    textTransform: 'uppercase',
  },
  docs: { marginTop: spacing.sm },
  docImg: { width: 120, height: 120, borderRadius: radius.card, marginRight: spacing.sm, backgroundColor: colors.border },
  // Equipo IA: pre-chequeo del verificador.
  precheckBox: {
    marginTop: spacing.sm, padding: spacing.sm,
    borderRadius: radius.card, backgroundColor: '#F4F3FD',
  },
  precheckHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  precheckTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
  precheckScore: { fontSize: fontSize.sm, fontWeight: '800' },
  precheckOk: { color: '#1E7E34' },
  precheckWarn: { color: '#B7791F' },
  precheckBad: { color: '#C0392B' },
  precheckFlag: { fontSize: fontSize.sm, color: colors.text, marginTop: 4 },
  verActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  approveBtn: {
    flex: 1, backgroundColor: colors.success, borderRadius: radius.button,
    paddingVertical: 12, alignItems: 'center',
  },
  approveText: { color: '#fff', fontWeight: '800', fontSize: fontSize.md },
  rejectBtn: {
    flex: 1, backgroundColor: colors.dangerSoft, borderRadius: radius.button,
    paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#F5C6C6',
  },
  rejectText: { color: colors.danger, fontWeight: '800', fontSize: fontSize.md },
  disabled: { opacity: 0.6 },

  fieldLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.muted, marginBottom: 6 },
  input: {
    backgroundColor: colors.bg, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, fontSize: fontSize.md, color: colors.text,
  },
  reasonInput: { minHeight: 90, textAlignVertical: 'top' },
  suspendRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  suspendBtn: {
    flex: 1, backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: '#F5C6C6',
    borderRadius: radius.button, paddingVertical: 12, alignItems: 'center',
  },
  suspendText: { color: colors.danger, fontWeight: '800', fontSize: fontSize.md },
  unsuspendBtn: {
    flex: 1, backgroundColor: colors.light, borderWidth: 1, borderColor: colors.primary,
    borderRadius: radius.button, paddingVertical: 12, alignItems: 'center',
  },
  unsuspendText: { color: colors.primary, fontWeight: '800', fontSize: fontSize.md },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, maxHeight: '80%',
  },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  modalClose: { fontSize: 20, color: colors.muted, padding: 4 },
  modalCta: { marginTop: spacing.lg },
});
