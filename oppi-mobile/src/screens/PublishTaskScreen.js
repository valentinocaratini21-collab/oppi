import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import * as Location from 'expo-location';
import { pickAndUpload } from '../utils/photos';
import { FEATURE_MAP } from '../config';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Publicar tarea: POST /api/tasks con toggle "Lo necesito hoy" (urgent).
 */
export function PublishTaskScreen({ navigation }) {
  const { isLoggedIn } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [barrio, setBarrio] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [photos, setPhotos] = useState([]); // [{ url, key }]
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [loading, setLoading] = useState(false);
  // Ubicación: { lat, lng } o null (si se deniega el permiso, publica sin coords).
  const [coords, setCoords] = useState(null);
  const [locating, setLocating] = useState(false);

  /** "Usar mi ubicación": si el permiso se deniega, se publica igual sin
   *  coordenadas (igual que hoy). */
  async function useMyLocation() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Sin acceso a tu ubicación',
          'Podés publicar igual: la tarea se va a mostrar sin distancia.'
        );
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch {
      Alert.alert(
        'No pudimos obtener tu ubicación',
        'Revisá que el GPS esté activado. Podés publicar igual sin ubicación.'
      );
    } finally {
      setLocating(false);
    }
  }

  function clearLocation() {
    setCoords(null);
  }

  async function addPhoto() {
    setUploadingPhoto(true);
    try {
      const { canceled, file } = await pickAndUpload();
      if (canceled) return;
      setPhotos((prev) => [...prev, { url: file.url, key: file.key }]);
    } catch (e) {
      Alert.alert('No pudimos subir la foto', e.message || 'Probá de nuevo.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  function removePhoto(key) {
    setPhotos((prev) => prev.filter((p) => p.key !== key));
  }

  async function onSubmit() {
    if (!isLoggedIn) {
      Alert.alert('Entrá primero', 'Necesitás una cuenta para publicar una tarea.');
      return;
    }
    if (!title.trim()) {
      Alert.alert('Falta el título', 'Contanos qué necesitás en una frase.');
      return;
    }
    const min = priceMin ? parseInt(priceMin.replace(/[^0-9]/g, ''), 10) : null;
    const max = priceMax ? parseInt(priceMax.replace(/[^0-9]/g, ''), 10) : null;
    if (min != null && max != null && min > max) {
      Alert.alert('Precios', 'El precio mínimo no puede ser mayor que el máximo.');
      return;
    }
    setLoading(true);
    try {
      const { task } = await api.createTask({
        title: title.trim(),
        description: description.trim(),
        category: category.trim(),
        barrio: barrio.trim(),
        price_min_gs: min,
        price_max_gs: max,
        urgent,
        photos: photos.map((p) => p.url),
        ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
      });
      navigation.replace('TaskDetail', { taskId: task.id });
    } catch (e) {
      Alert.alert('No pudimos publicar', e.message || 'Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="Publicar tarea" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>¿Qué necesitás? *</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Ej. Arreglar la canilla de la cocina"
          placeholderTextColor={colors.muted}
        />

        <Text style={styles.label}>Contanos más detalles</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder="Qué hay que hacer, medidas, horarios en los que estás…"
          placeholderTextColor={colors.muted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        <Text style={styles.label}>Fotos (opcional)</Text>
        <Text style={styles.hint}>Una foto vale más que mil palabras: mostrá lo que hay que arreglar.</Text>
        <View style={styles.photosRow}>
          {photos.map((p) => (
            <View key={p.key} style={styles.thumbWrap}>
              <Image source={{ uri: p.url }} style={styles.thumb} />
              <TouchableOpacity style={styles.thumbRemove} onPress={() => removePhoto(p.key)} hitSlop={10}>
                <Text style={styles.thumbRemoveText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity
            style={styles.addPhoto}
            onPress={addPhoto}
            disabled={uploadingPhoto}
            activeOpacity={0.8}
          >
            {uploadingPhoto ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={styles.addPhotoText}>📷{'\n'}Agregar</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Rubro</Text>
        <TextInput
          style={styles.input}
          value={category}
          onChangeText={setCategory}
          placeholder="Ej. plomería, electricidad, pintura"
          placeholderTextColor={colors.muted}
        />

        <Text style={styles.label}>Barrio</Text>
        <TextInput
          style={styles.input}
          value={barrio}
          onChangeText={setBarrio}
          placeholder="Ej. Villa Morra"
          placeholderTextColor={colors.muted}
        />

        {/* Con FEATURE_MAP en false se oculta: se publica sin coords, como antes. */}
        {FEATURE_MAP && (
          <>
            <Text style={styles.label}>Ubicación</Text>
            <View style={styles.locRow}>
              <TouchableOpacity
                style={[styles.locBtn, coords && styles.locBtnActive]}
                onPress={useMyLocation}
                disabled={locating}
                activeOpacity={0.85}
              >
                <Text style={[styles.locBtnText, coords && styles.locBtnTextActive]}>
                  {locating
                    ? 'Buscando tu ubicación…'
                    : coords
                      ? '📍 Ubicación agregada'
                      : '📍 Usar mi ubicación'}
                </Text>
              </TouchableOpacity>
              {coords && (
                <TouchableOpacity onPress={clearLocation} style={styles.locClear} hitSlop={10}>
                  <Text style={styles.locClearText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.hint}>
              {coords
                ? 'Los handymen van a ver tu tarea ordenada por cercanía.'
                : 'Opcional: los handymen ven tu tarea ordenada por cercanía.'}
            </Text>
          </>
        )}

        <Text style={styles.label}>Presupuesto en Gs. (opcional)</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.half]}
            value={priceMin}
            onChangeText={(t) => setPriceMin(t.replace(/[^0-9]/g, ''))}
            placeholder="Mínimo"
            placeholderTextColor={colors.muted}
            keyboardType="numeric"
          />
          <TextInput
            style={[styles.input, styles.half]}
            value={priceMax}
            onChangeText={(t) => setPriceMax(t.replace(/[^0-9]/g, ''))}
            placeholder="Máximo"
            placeholderTextColor={colors.muted}
            keyboardType="numeric"
          />
        </View>

        <View style={styles.urgentRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.urgentTitle}>⚡ Lo necesito hoy</Text>
            <Text style={styles.urgentSub}>Tu tarea se destaca y llega primero a los handymen.</Text>
          </View>
          <Switch
            value={urgent}
            onValueChange={setUrgent}
            trackColor={{ false: colors.border, true: colors.primary }}
          />
        </View>

        <PrimaryButton title="Publicar tarea" onPress={onSubmit} loading={loading} style={styles.cta} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md, paddingBottom: spacing.lg },
  label: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: colors.card, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, fontSize: fontSize.md, color: colors.text,
  },
  multiline: { minHeight: 100 },
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  hint: { fontSize: fontSize.xs, color: colors.muted, marginBottom: spacing.sm },
  photosRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xs },
  thumbWrap: { position: 'relative' },
  thumb: { width: 76, height: 76, borderRadius: radius.button, backgroundColor: colors.light },
  thumbRemove: {
    position: 'absolute', top: -8, right: -8, width: 26, height: 26,
    borderRadius: 13, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  thumbRemoveText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '800' },
  addPhoto: {
    width: 76, height: 76, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, borderStyle: 'dashed', backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  addPhotoText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '700', textAlign: 'center' },
  urgentRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: radius.card, padding: spacing.md, marginTop: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  urgentTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  urgentSub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  locBtn: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center',
  },
  locBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  locBtnText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
  locBtnTextActive: { color: '#fff' },
  locClear: {
    backgroundColor: colors.card, borderRadius: 20, borderWidth: 1,
    borderColor: colors.border, width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
  },
  locClearText: { color: colors.muted, fontWeight: '800' },
  cta: { marginTop: spacing.lg },
});
