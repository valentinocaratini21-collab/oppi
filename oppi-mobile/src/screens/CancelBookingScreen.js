import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError } from '../api/client';
import { ScreenHeader } from '../components/ScreenHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { WildcardDots } from '../components/WildcardDots';
import { dateTimeEs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Cancelar reserva (nueva política de comodines).
 *
 * Params: { bookingId, role: 'cliente' | 'pro' | 'business', serviceName? }
 *
 * - GET /api/bookings/:id/cancel-preview → { free_until, dentro_plazo_gratis,
 *   resolucion, comodines: { balance, proximo_en, reset_fecha }, policy_text }
 * - Dentro del plazo: "Estás dentro del plazo gratis (hasta {fecha}). No usa
 *   comodines." + motivo opcional (radios) + [Cancelar reserva].
 * - Tardía: "Esta cancelación usa 1 comodín." + puntitos + "Te quedarían {n} de 3"
 *   + "Próximo comodín {x} de 10" + [Sí, cancelar reserva].
 * - Motivo obligatorio para pro/empresa (con sus opciones); opcional para cliente.
 * - Si el endpoint nuevo no existe (404), cae con gracia al flujo legacy
 *   (POST cancel-preview + POST cancel sin motivo).
 */
const CLIENT_REASONS = [
  'Cambio de planes',
  'Encontré otra opción',
  'El horario ya no me sirve',
  'Emergencia o imprevisto',
  'Otro',
];

const PRO_REASONS = [
  'Emergencia personal',
  'Me enfermé',
  'Problema de transporte',
  'Doble reserva por error',
  'El cliente pidió reprogramar',
  'Otro (contame qué pasó)',
];

export function CancelBookingScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { bookingId, role = 'cliente', serviceName } = route.params || {};
  const isClient = role === 'cliente';
  const reasons = isClient ? CLIENT_REASONS : PRO_REASONS;

  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [legacy, setLegacy] = useState(null); // fallback al contrato viejo
  const [error, setError] = useState(null);
  const [reason, setReason] = useState(null);
  const [reasonDetail, setReasonDetail] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await api.cancelPolicyPreview(bookingId);
      setPreview(p);
      setLegacy(null);
    } catch (e) {
      // El endpoint nuevo todavía no existe → fallback legacy con gracia.
      if (e instanceof ApiError && e.status === 404) {
        try {
          const p = await api.cancelPreview(bookingId);
          setLegacy(p);
          setPreview(null);
        } catch (e2) {
          setError(e2.message || 'No pudimos cargar la política de cancelación.');
        }
      } else {
        setError(e.message || 'No pudimos cargar la política de cancelación.');
      }
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    load();
  }, [load]);

  const comodines = preview?.comodines || {};
  const balance = Number(comodines.balance ?? 3);
  const dentroPlazo = !!preview?.dentro_plazo_gratis || preview?.resolucion === 'gratis';
  const needsDetail = reason === 'Otro' || reason === 'Otro (contame qué pasó)';
  const reasonRequired = !isClient;
  const reasonOk = isClient
    ? !needsDetail || reasonDetail.trim().length > 0
    : !!reason && (!needsDetail || reasonDetail.trim().length > 0);

  async function doCancel() {
    if (!reasonOk) {
      Alert.alert(
        'Falta el motivo',
        isClient
          ? 'Si elegís "Otro", contanos en una línea qué pasó.'
          : 'Para cancelar como profesional tenés que elegir un motivo (y detallarlo si es "Otro").'
      );
      return;
    }
    setCancelling(true);
    try {
      if (preview) {
        await api.cancelBookingWithReason(bookingId, {
          reason,
          reason_detail: reasonDetail.trim() || undefined,
        });
      } else {
        // Fallback legacy: el backend viejo no acepta motivo.
        await api.cancelBooking(bookingId);
      }
      Alert.alert('Reserva cancelada', 'Listo, la reserva quedó cancelada.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('No pudimos cancelar', e.message || 'Intentá de nuevo.');
    } finally {
      setCancelling(false);
    }
  }

  function renderReasonPicker() {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Motivo {isClient ? <Text style={styles.optional}>(opcional)</Text> : <Text style={styles.required}>(obligatorio)</Text>}
        </Text>
        {reasons.map((r) => {
          const active = reason === r;
          return (
            <TouchableOpacity
              key={r}
              style={[styles.radio, active && styles.radioActive]}
              onPress={() => setReason(r)}
              activeOpacity={0.85}
            >
              <View style={[styles.radioDot, active && styles.radioDotActive]} />
              <Text style={[styles.radioText, active && styles.radioTextActive]}>{r}</Text>
            </TouchableOpacity>
          );
        })}
        {needsDetail && (
          <TextInput
            style={styles.input}
            value={reasonDetail}
            onChangeText={setReasonDetail}
            placeholder="Contanos en una línea qué pasó…"
            placeholderTextColor={colors.muted}
            multiline
          />
        )}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Cancelar reserva" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}>
        {serviceName ? <Text style={styles.service}>{serviceName}</Text> : null}

        {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />}

        {!loading && error && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>😕 Algo salió mal</Text>
            <Text style={styles.cardText}>{error}</Text>
            <PrimaryButton title="Reintentar" onPress={load} style={{ marginTop: spacing.sm }} />
          </View>
        )}

        {/* --- Preview nuevo: dentro del plazo --- */}
        {!loading && !error && preview && dentroPlazo && (
          <View style={[styles.card, styles.okCard]}>
            <Text style={styles.okTitle}>✅ Estás dentro del plazo gratis</Text>
            <Text style={styles.cardText}>
              Estás dentro del plazo gratis (hasta {dateTimeEs(preview.free_until)}). No usa comodines.
            </Text>
          </View>
        )}

        {/* --- Preview nuevo: tardía --- */}
        {!loading && !error && preview && !dentroPlazo && (
          <View style={[styles.card, styles.warnCard]}>
            <Text style={styles.warnTitle}>⚠️ Esta cancelación usa 1 comodín.</Text>
            <View style={styles.dotsRow}>
              <WildcardDots balance={balance} />
              <Text style={styles.dotsLabel}>Te quedarían {Math.max(0, balance - 1)} de 3</Text>
            </View>
            {comodines.proximo_en ? (
              <Text style={styles.cardText}>Próximo comodín {comodines.proximo_en} de 10 reservas</Text>
            ) : null}
            {preview.resolucion === 'sin_comodin' && (
              <Text style={[styles.cardText, styles.bold]}>
                No te quedan comodines: esta cancelación baja tu % de cumplimiento.
              </Text>
            )}
          </View>
        )}

        {/* --- Fallback legacy --- */}
        {!loading && !error && legacy && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Cancelar reserva</Text>
            <Text style={styles.cardText}>
              {legacy.free_cancel
                ? `Cancelación gratis (faltan ${legacy.hours_before} h para el turno).`
                : 'Esta cancelación está fuera del plazo gratis.'}
            </Text>
          </View>
        )}

        {!loading && !error && (preview || legacy) && (
          <>
            {preview?.policy_text ? (
              <Text style={styles.policyText}>{preview.policy_text}</Text>
            ) : null}
            {renderReasonPicker()}
            <PrimaryButton
              title={preview && !dentroPlazo ? 'Sí, cancelar reserva' : 'Cancelar reserva'}
              variant="danger"
              loading={cancelling}
              disabled={!reasonOk}
              onPress={doCancel}
              style={styles.cta}
            />
            <TouchableOpacity onPress={() => navigation.navigate('CancellationPolicy')} activeOpacity={0.85}>
              <Text style={styles.policyLink}>Ver política de cancelación →</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  service: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#1A1A2E',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  okCard: { borderLeftWidth: 4, borderLeftColor: colors.success },
  okTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.success, marginBottom: 6 },
  warnCard: { borderLeftWidth: 4, borderLeftColor: colors.warning },
  warnTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  cardTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  cardText: { fontSize: fontSize.sm, color: colors.muted, lineHeight: 20, marginTop: 4 },
  bold: { fontWeight: '800', color: colors.text },
  optional: { fontWeight: '400', color: colors.muted, fontSize: fontSize.sm },
  required: { fontWeight: '700', color: colors.danger, fontSize: fontSize.sm },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  dotsLabel: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  radio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  radioActive: { borderColor: colors.primary, backgroundColor: colors.light },
  radioDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
  },
  radioDotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  radioText: { fontSize: fontSize.md, color: colors.text, flex: 1 },
  radioTextActive: { fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    padding: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
    minHeight: 64,
    textAlignVertical: 'top',
    marginTop: spacing.xs,
  },
  policyText: { fontSize: fontSize.xs, color: colors.muted, lineHeight: 18, marginBottom: spacing.sm },
  cta: { marginTop: spacing.sm },
  policyLink: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
