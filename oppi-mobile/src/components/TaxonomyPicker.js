import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { api } from '../api/client';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Fallback local si el backend todavía no expone GET /api/taxonomy.
 * Misma forma: [{ id, nombre, icono, professions: [{id, nombre}], subcategories }].
 */
export const TAXONOMY_FALLBACK = [
  { id: 'belleza', nombre: 'Belleza', icono: '💈', professions: [
    { id: 'peluquera', nombre: 'Peluquera/o' }, { id: 'barbera', nombre: 'Barbera/o' },
    { id: 'manicura', nombre: 'Manicurista' }, { id: 'maquillaje', nombre: 'Maquilladora' },
    { id: 'masajes', nombre: 'Masajista' },
  ], subcategories: [] },
  { id: 'hogar', nombre: 'Hogar', icono: '🏠', professions: [
    { id: 'electricidad', nombre: 'Electricista' }, { id: 'plomeria', nombre: 'Plomero' },
    { id: 'limpieza', nombre: 'Limpieza' }, { id: 'climatizacion', nombre: 'Climatización' },
  ], subcategories: [] },
  { id: 'salud', nombre: 'Salud', icono: '🩺', professions: [
    { id: 'fisioterapia', nombre: 'Fisioterapeuta' }, { id: 'nutricion', nombre: 'Nutricionista' },
    { id: 'psicologia', nombre: 'Psicólogo/a' },
  ], subcategories: [] },
  { id: 'clases', nombre: 'Clases', icono: '📚', professions: [
    { id: 'ingles', nombre: 'Profesor/a de inglés' }, { id: 'musica', nombre: 'Profesor/a de música' },
    { id: 'deporte', nombre: 'Entrenador/a' },
  ], subcategories: [] },
  { id: 'mascotas', nombre: 'Mascotas', icono: '🐾', professions: [
    { id: 'peluqueria_canina', nombre: 'Peluquería canina' }, { id: 'paseador', nombre: 'Paseador/a' },
  ], subcategories: [] },
  { id: 'eventos', nombre: 'Eventos', icono: '🎉', professions: [
    { id: 'fotografia', nombre: 'Fotógrafo/a' }, { id: 'catering', nombre: 'Catering' },
    { id: 'decoracion', nombre: 'Decoración' },
  ], subcategories: [] },
  { id: 'autos', nombre: 'Autos', icono: '🚗', professions: [
    { id: 'mecanica', nombre: 'Mecánico/a' }, { id: 'lavado', nombre: 'Lavadero' },
  ], subcategories: [] },
  { id: 'tech', nombre: 'Tecnología', icono: '💻', professions: [
    { id: 'soporte', nombre: 'Soporte técnico' }, { id: 'diseno', nombre: 'Diseñador/a' },
  ], subcategories: [] },
];

/**
 * Hook para cargar la taxonomía con fallback local.
 * Devuelve { categories, loading }.
 */
export function useTaxonomy() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.taxonomy();
        const list = data?.categories || [];
        if (alive) setCategories(list.length ? list : TAXONOMY_FALLBACK);
      } catch {
        if (alive) setCategories(TAXONOMY_FALLBACK);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { categories, loading };
}

/**
 * Picker en cascada categoría → profesión.
 * Props: value { categoryId, professionId, professionName }, onChange(sel),
 * opcional: label, showFallback (si true, permite escribir libre cuando
 * la taxonomía no carga).
 */
export function TaxonomyPicker({ value = {}, onChange, label = 'Rubro' }) {
  const { categories, loading } = useTaxonomy();
  const [freeText, setFreeText] = useState('');

  const categoryId = value.categoryId || null;
  const category = categories.find((c) => String(c.id) === String(categoryId)) || null;
  const professions = category?.professions || [];

  function selectCategory(c) {
    onChange({ categoryId: c.id, categoryName: c.nombre, professionId: null, professionName: '' });
  }

  function selectProfession(p) {
    onChange({
      categoryId: category?.id || null,
      categoryName: category?.nombre || '',
      professionId: p.id,
      professionName: p.nombre,
    });
  }

  if (loading) {
    return (
      <View>
        <Text style={styles.label}>{label}</Text>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.label}>{label} — categoría</Text>
      <View style={styles.chips}>
        {categories.map((c) => (
          <TouchableOpacity
            key={c.id}
            style={[styles.chip, String(categoryId) === String(c.id) && styles.chipActive]}
            onPress={() => selectCategory(c)}
            activeOpacity={0.85}
          >
            <Text style={[styles.chipText, String(categoryId) === String(c.id) && styles.chipTextActive]}>
              {c.icono ? `${c.icono} ` : ''}{c.nombre}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {category && professions.length > 0 && (
        <>
          <Text style={styles.label}>Profesión</Text>
          <View style={styles.chips}>
            {professions.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.chip, String(value.professionId) === String(p.id) && styles.chipActive]}
                onPress={() => selectProfession(p)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, String(value.professionId) === String(p.id) && styles.chipTextActive]}>
                  {p.nombre}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* Fallback: escribir libre si la taxonomía no trae nada útil */}
      <Text style={styles.label}>O escribilo libre</Text>
      <TextInput
        style={styles.input}
        value={freeText}
        onChangeText={(t) => {
          setFreeText(t);
          onChange({ categoryId: null, categoryName: '', professionId: null, professionName: t.trim() });
        }}
        placeholder="Ej: Peluquería canina"
        placeholderTextColor={colors.muted}
      />
      {!!value.professionName && (
        <Text style={styles.selected}>✓ {value.professionName}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 14,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#fff' },
  input: {
    backgroundColor: colors.card, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, fontSize: fontSize.md, color: colors.text,
  },
  selected: { fontSize: fontSize.sm, color: colors.success, fontWeight: '700', marginTop: spacing.sm },
});
