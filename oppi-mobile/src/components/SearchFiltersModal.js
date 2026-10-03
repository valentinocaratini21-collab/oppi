import React, { useState } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from './PrimaryButton';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Modal de filtros para la búsqueda (modo profesionales).
 *
 * Props:
 *   visible, initial { minPrice, maxPrice, disponibilidad, orden },
 *   onApply(filters), onClose().
 *
 * disponibilidad: '' | 'hoy' | 'manana' | 'semana'
 * orden: 'relevancia' | 'precio_asc' | 'precio_desc' | 'rating' | 'distancia'
 */
export const FILTER_DEFAULTS = { minPrice: '', maxPrice: '', disponibilidad: '', orden: 'relevancia' };

const DISP_OPTIONS = [
  { value: '', label: 'Cualquiera' },
  { value: 'hoy', label: '📅 Hoy' },
  { value: 'manana', label: '🌅 Mañana' },
  { value: 'semana', label: '🗓️ Esta semana' },
];

const ORDER_OPTIONS = [
  { value: 'relevancia', label: 'Relevancia' },
  { value: 'precio_asc', label: 'Menor precio' },
  { value: 'precio_desc', label: 'Mayor precio' },
  { value: 'rating', label: 'Mejor rating' },
  { value: 'distancia', label: 'Distancia' },
];

export function SearchFiltersModal({ visible, initial = FILTER_DEFAULTS, onApply, onClose }) {
  const insets = useSafeAreaInsets();
  const [minPrice, setMinPrice] = useState(initial.minPrice || '');
  const [maxPrice, setMaxPrice] = useState(initial.maxPrice || '');
  const [disponibilidad, setDisponibilidad] = useState(initial.disponibilidad || '');
  const [orden, setOrden] = useState(initial.orden || 'relevancia');
  const [error, setError] = useState('');

  // Al abrirse, sincronizar con los filtros vigentes.
  React.useEffect(() => {
    if (visible) {
      setMinPrice(initial.minPrice || '');
      setMaxPrice(initial.maxPrice || '');
      setDisponibilidad(initial.disponibilidad || '');
      setOrden(initial.orden || 'relevancia');
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function apply() {
    const min = minPrice ? parseInt(minPrice, 10) : null;
    const max = maxPrice ? parseInt(maxPrice, 10) : null;
    if (min !== null && max !== null && min > max) {
      setError('El precio mínimo no puede ser mayor que el máximo.');
      return;
    }
    setError('');
    onApply({ minPrice: minPrice || '', maxPrice: maxPrice || '', disponibilidad, orden });
  }

  function clear() {
    setMinPrice('');
    setMaxPrice('');
    setDisponibilidad('');
    setOrden('relevancia');
    setError('');
    onApply({ ...FILTER_DEFAULTS });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
        >
          <View style={styles.head}>
            <Text style={styles.title}>Filtros</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.close}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Precio en Gs.</Text>
            <View style={styles.priceRow}>
              <TextInput
                style={[styles.input, styles.priceInput]}
                value={minPrice}
                onChangeText={(t) => setMinPrice(t.replace(/[^0-9]/g, ''))}
                placeholder="Mín."
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
              />
              <Text style={styles.dash}>–</Text>
              <TextInput
                style={[styles.input, styles.priceInput]}
                value={maxPrice}
                onChangeText={(t) => setMaxPrice(t.replace(/[^0-9]/g, ''))}
                placeholder="Máx."
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
              />
            </View>

            <Text style={styles.label}>Disponibilidad</Text>
            <View style={styles.chips}>
              {DISP_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.chip, disponibilidad === o.value && styles.chipActive]}
                  onPress={() => setDisponibilidad(o.value)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.chipText, disponibilidad === o.value && styles.chipTextActive]}>
                    {o.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Ordenar por</Text>
            <View style={styles.chips}>
              {ORDER_OPTIONS.map((o) => (
                <TouchableOpacity
                  key={o.value}
                  style={[styles.chip, orden === o.value && styles.chipActive]}
                  onPress={() => setOrden(o.value)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.chipText, orden === o.value && styles.chipTextActive]}>
                    {o.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {!!error && <Text style={styles.error}>⚠ {error}</Text>}

            <PrimaryButton
              title="Aplicar filtros"
              onPress={apply}
              style={{ minHeight: 52, borderRadius: 16, marginTop: spacing.lg }}
            />
            <PrimaryButton title="Limpiar" variant="ghost" onPress={clear} />
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26,26,46,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, maxHeight: '92%',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  close: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  closeText: { fontSize: fontSize.md, color: colors.text, fontWeight: '700' },
  label: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: 6 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dash: { fontSize: fontSize.lg, color: colors.muted },
  priceInput: { flex: 1 },
  input: {
    backgroundColor: colors.card, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, fontSize: fontSize.md, color: colors.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 14,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#fff' },
  error: {
    fontSize: fontSize.sm, color: colors.danger, fontWeight: '700',
    backgroundColor: '#FDECEC', borderRadius: radius.button, padding: 10, marginTop: spacing.md,
  },
});
