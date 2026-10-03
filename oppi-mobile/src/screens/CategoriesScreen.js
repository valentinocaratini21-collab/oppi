import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { useTaxonomy } from '../components/TaxonomyPicker';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Categorías (ruta "Categories"): grilla de 8 con icono + nombre.
 * Tocar una → Subcategories (profesiones y subcategorías).
 */
export function CategoriesScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { categories, loading } = useTaxonomy();
  const [refreshing, setRefreshing] = React.useState(false);

  function reload() {
    // useTaxonomy carga una vez; el pull refresca la pantalla completa.
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Categorías" onBack={() => navigation.goBack()} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.muted}>Cargando categorías…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + spacing.lg }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
        >
          {categories.slice(0, 8).map((c) => (
            <TouchableOpacity
              key={c.id}
              style={styles.tile}
              onPress={() => navigation.navigate('Subcategories', { category: c })}
              activeOpacity={0.85}
            >
              <Card style={styles.card}>
                <Text style={styles.icon}>{c.icono || '🏷️'}</Text>
                <Text style={styles.name} numberOfLines={2}>{c.nombre}</Text>
              </Card>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: colors.muted },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', padding: spacing.md, gap: spacing.sm,
  },
  tile: { width: '48%' },
  card: { alignItems: 'center', paddingVertical: spacing.lg },
  icon: { fontSize: 40 },
  name: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginTop: spacing.sm, textAlign: 'center' },
});
