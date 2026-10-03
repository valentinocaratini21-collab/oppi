import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { ScreenHeader } from '../components/ScreenHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { pickAndUpload } from '../utils/photos';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Reportar no-show (cliente y profesional).
 *
 * Params: { bookingId, asRole: 'cliente' | 'pro', serviceName?, otherName? }
 *
 * POST /api/bookings/:id/report-no-show { kind, notes?, photo_url? }
 * kind: 'pro' si lo reporta el cliente, 'client' si lo reporta el pro.
 *
 * Promesas del dueño:
 * - Cliente: "Te devolvemos el pago completo." + queda registrado en el
 *   cumplimiento del profesional.
 * - Pro: "El pago queda para vos." + queda registrado en el cumplimiento del cliente.
 */
export function ReportNoShowScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { bookingId, asRole = 'cliente', serviceName, otherName } = route.params || {};
  const client = asRole === 'cliente';

  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState(null); // { url }
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);

  async function addPhoto() {
    setUploading(true);
    try {
      const res = await pickAndUpload({ quality: 0.7 });
      if (!res.canceled) setPhoto({ url: res.file.url });
    } catch (e) {
      Alert.alert('No pudimos subir la foto', e.message || 'Intentá de nuevo.');
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setSending(true);
    try {
      await api.reportNoShow(bookingId, {
        kind: client ? 'pro' : 'client',
        notes: notes.trim() || undefined,
        photo_url: photo?.url,
      });
      Alert.alert(
        'Reportado',
        client
          ? 'Lo registramos. Te devolvemos el pago completo y queda asentado en el cumplimiento del profesional.'
          : 'Lo registramos. El pago queda para vos y queda asentado en el cumplimiento del cliente.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e) {
      Alert.alert('No pudimos reportarlo', e.message || 'Intentá de nuevo.');
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title={client ? 'El profesional no vino' : 'El cliente no vino'} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}>
        {serviceName ? <Text style={styles.service}>{serviceName}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.title}>
            {client
              ? `¿${otherName || 'El profesional'} no vino? 😕`
              : `¿${otherName || 'El cliente'} no vino? 🚫`}
          </Text>
          <Text style={styles.sub}>
            {client
              ? 'Lo marcamos como no-show. Esto no es una venganza: solo registramos lo que pasó, y el profesional puede responder.'
              : 'Lo marcamos como no-show. Queda registrado en su cumplimiento y le avisamos.'}
          </Text>
        </View>

        {/* Promesas */}
        <View style={[styles.card, styles.promiseCard]}>
          <Text style={styles.promiseTitle}>Lo que te prometemos</Text>
          {client ? (
            <>
              <Text style={styles.promise}>✅ Te devolvemos el pago completo.</Text>
              <Text style={styles.promise}>✅ Queda registrado en su cumplimiento.</Text>
              <Text style={styles.promise}>✅ Te avisamos cuando se resuelva.</Text>
            </>
          ) : (
            <>
              <Text style={styles.promise}>✅ El pago queda para vos.</Text>
              <Text style={styles.promise}>✅ Queda registrado en su cumplimiento.</Text>
              <Text style={styles.promise}>✅ Le avisamos al cliente.</Text>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>¿Querés agregar un detalle? <Text style={styles.optional}>(opcional)</Text></Text>
          <TextInput
            style={styles.input}
            value={notes}
            onChangeText={setNotes}
            placeholder={client ? 'Ej: lo esperé 30 minutos en la puerta…' : 'Ej: no atendió el teléfono ni los mensajes…'}
            placeholderTextColor={colors.muted}
            multiline
          />
          <Text style={[styles.cardTitle, { marginTop: spacing.md }]}>Foto <Text style={styles.optional}>(opcional)</Text></Text>
          {photo ? (
            <View style={styles.photoWrap}>
              <Image source={{ uri: photo.url }} style={styles.photo} />
              <TouchableOpacity onPress={() => setPhoto(null)} hitSlop={10} style={styles.photoRemove}>
                <Text style={styles.photoRemoveText}>✕ Quitar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.addPhoto} onPress={addPhoto} disabled={uploading} activeOpacity={0.8}>
              {uploading ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.addPhotoText}>📷 Agregar foto de respaldo</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        <PrimaryButton
          title={client ? 'Confirmar: el profesional no vino' : 'Confirmar: el cliente no vino'}
          variant={client ? 'primary' : 'danger'}
          loading={sending}
          onPress={submit}
          style={styles.cta}
        />
        <Text style={styles.fine}>
          Solo usalo si realmente no vino. Los reportes falsos también bajan tu cumplimiento.
        </Text>
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
  title: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginBottom: 6 },
  sub: { fontSize: fontSize.sm, color: colors.muted, lineHeight: 20 },
  promiseCard: { borderLeftWidth: 4, borderLeftColor: colors.success },
  promiseTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  promise: { fontSize: fontSize.sm, color: colors.text, lineHeight: 24, fontWeight: '600' },
  cardTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  optional: { fontWeight: '400', color: colors.muted, fontSize: fontSize.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.button,
    padding: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  addPhoto: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    borderRadius: radius.button,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  addPhotoText: { color: colors.primary, fontWeight: '700', fontSize: fontSize.sm },
  photoWrap: { alignItems: 'center', gap: spacing.sm },
  photo: { width: 160, height: 160, borderRadius: radius.button },
  photoRemove: { padding: spacing.xs },
  photoRemoveText: { color: colors.danger, fontWeight: '700', fontSize: fontSize.sm },
  cta: { marginTop: spacing.sm },
  fine: { fontSize: fontSize.xs, color: colors.muted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 18 },
});
