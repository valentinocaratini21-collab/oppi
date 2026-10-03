import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../../components/PrimaryButton';
import { pickAndUpload } from '../../utils/photos';
import { gs } from '../../utils';
import { colors, fontSize, spacing, radius } from '../../theme';

/**
 * Modal para crear/editar un servicio (negocio o profesional).
 * Props:
 *   visible, title, initial {name, price_gs, photo_url, description, includes[]},
 *   onClose(), onSave({name, price_gs, deposit_type: 'none', deposit_value: 0,
 *     photo_url, description, includes})
 *
 * Pago 100%: sin seña. El payload sigue mandando deposit_type 'none' por
 * compatibilidad con el contrato del backend.
 */
export function ServiceEditorModal({ visible, title, initial, onClose, onSave, saving }) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [description, setDescription] = useState('');
  const [includesText, setIncludesText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setName(initial?.name || '');
      setPrice(initial?.price_gs != null ? String(initial.price_gs) : '');
      setPhotoUrl(initial?.photo_url || '');
      setDescription(initial?.description || '');
      setIncludesText(Array.isArray(initial?.includes) ? initial.includes.join('\n') : '');
      setError('');
    }
  }, [visible, initial]);

  async function uploadPhoto() {
    setUploading(true);
    try {
      const res = await pickAndUpload({ allowsEditing: true, quality: 0.8 });
      if (!res.canceled) setPhotoUrl(res.file.url);
    } catch (e) {
      setError(e.message || 'No pudimos subir la foto.');
    } finally {
      setUploading(false);
    }
  }

  const priceInt = parseInt(price, 10);

  function handleSave() {
    const payload = {
      name: name.trim(),
      price_gs: priceInt,
      // Pago 100%: sin seña (el backend conserva el contrato).
      deposit_type: 'none',
      deposit_value: 0,
      photo_url: photoUrl || null,
      description: description.trim(),
      includes: includesText.split('\n').map((l) => l.trim()).filter(Boolean),
    };
    if (!payload.name) {
      setError('Poné el nombre del servicio.');
      return;
    }
    if (!Number.isInteger(priceInt) || priceInt <= 0) {
      setError('El precio tiene que ser un monto en guaraníes mayor a 0.');
      return;
    }
    setError('');
    onSave(payload);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
        >
          <View style={styles.head}>
            <Text style={styles.title}>{title || 'Servicio'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.close}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Nombre *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Ej: Corte mujer"
              placeholderTextColor={colors.muted}
            />

            <Text style={styles.label}>Foto del servicio</Text>
            {photoUrl ? (
              <View style={styles.photoRow}>
                <Image source={{ uri: photoUrl }} style={styles.photoThumb} />
                <TouchableOpacity onPress={() => setPhotoUrl('')} hitSlop={8}>
                  <Text style={styles.photoRemove}>Quitar</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.photoBtn} onPress={uploadPhoto} disabled={uploading}>
                {uploading ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Text style={styles.photoBtnText}>📷 Elegir foto de la galería</Text>
                )}
              </TouchableOpacity>
            )}

            <Text style={styles.label}>Descripción</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="Contá de qué se trata el servicio…"
              placeholderTextColor={colors.muted}
              multiline
            />

            <Text style={styles.label}>Incluye (uno por línea)</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={includesText}
              onChangeText={setIncludesText}
              placeholder={'Ej:\nLavado\nCorte\nPeinado final'}
              placeholderTextColor={colors.muted}
              multiline
            />

            <Text style={styles.label}>Precio (Gs.) *</Text>
            <TextInput
              style={[styles.input, !!error && styles.inputError]}
              value={price}
              onChangeText={(t) => setPrice(t.replace(/[^0-9]/g, ''))}
              placeholder="85000"
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
            />
            <Text style={styles.hint}>
              El cliente paga el 100% al reservar (pago simulado por ahora).
            </Text>

            {!!error && <Text style={styles.error}>⚠ {error}</Text>}

            <PrimaryButton
              title="Guardar"
              onPress={handleSave}
              loading={!!saving}
              style={{ minHeight: 52, borderRadius: 16, marginTop: spacing.md }}
            />
            <PrimaryButton title="Cancelar" variant="ghost" onPress={onClose} />
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26,26,46,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    maxHeight: '92%',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  close: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  closeText: { fontSize: fontSize.md, color: colors.text, fontWeight: '700' },
  label: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, fontSize: fontSize.md, color: colors.text,
  },
  inputError: { borderColor: colors.danger, borderWidth: 2 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  photoBtn: {
    backgroundColor: colors.card, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, alignItems: 'center',
  },
  photoBtnText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  photoThumb: { width: 80, height: 80, borderRadius: radius.button },
  photoRemove: { color: colors.danger, fontSize: fontSize.sm, fontWeight: '700' },
  hint: { fontSize: fontSize.xs, color: colors.muted, marginTop: 4 },
  error: {
    fontSize: fontSize.sm, color: colors.danger, fontWeight: '700',
    backgroundColor: '#FDECEC', borderRadius: radius.button, padding: 10, marginTop: spacing.md,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 14,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#fff' },
});
