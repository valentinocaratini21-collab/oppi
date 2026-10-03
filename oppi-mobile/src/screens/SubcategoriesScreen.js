import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors, fontSize, spacing } from '../theme';

/**
 * Subcategorías (ruta "Subcategories", params {category}).
 * Muestra profesiones y subcategorías de la categoría elegida;
 * tocar una busca profesionales con ese rubro.
 */
export function SubcategoriesScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { category } = route.params || {};
  const professions = category?.professions || [];
  const subcategories = category?.subcategories || [];

  function searchFor(rubro) {
    navigation.navigate('Buscar', { category: rubro });
  }

  if (!category) {
    return (
      <View style={styles.wrap}>
        <ScreenHeader title="Categoría" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>😕</Text>
          <Text style={styles.emptyTitle}>Elegí una categoría primero</Text>
        </View>
      </View>
    );
  }

  const empty = professions.length === 0 && subcategories.length === 0;

  return (
    <View style={styles.wrap}>
      <ScreenHeader
        title={`${category.icono || ''} ${category.nombre || 'Categoría'}`.trim()}
        onBack={() => navigation.goBack()}
      />
      <ScrollView contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}>
        {empty ? (
          <Card>
            <Text style={styles.emptyTitle}>Nada por acá todavía 🗂️</Text>
            <Text style={styles.emptySub}>
              Esta categoría todavía no tiene profesiones cargadas. Probá con otra.
            </Text>
          </Card>
        ) : (
          <>
            {professions.length > 0 && (
              <>
                <Text style={styles.sec}>Profesiones</Text>
                {professions.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    activeOpacity={0.85}
                    onPress={() => searchFor(p.nombre)}
                  >
                    <Card>
                      <Text style={styles.item}>{p.nombre}</Text>
                      <Text style={styles.link}>Buscar →</Text>
                    </Card>
                  </TouchableOpacity>
                ))}
              </>
            )}
            {subcategories.length > 0 && (
              <>
                <Text style={styles.sec}>Subcategorías</Text>
                {subcategories.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    activeOpacity={0.85}
                    onPress={() => searchFor(s.nombre)}
                  >
                    <Card>
                      <Text style={styles.item}>{s.nombre}</Text>
                      <Text style={styles.link}>Buscar →</Text>
                    </Card>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12, padding: spacing.lg },
  inner: { padding: spacing.md },
  sec: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  item: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  link: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '700', marginTop: 4 },
  emptyEmoji: { fontSize: 64 },
  emptyTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptySub: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 20 },
});
