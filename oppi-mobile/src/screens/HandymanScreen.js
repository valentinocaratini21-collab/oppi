import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Chamba (marketplace handyman): explorar tareas abiertas,
 * filtro "Lo necesito hoy" (urgentes) y botón para publicar tarea.
 */
export function HandymanScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [tasks, setTasks] = useState([]);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [barrio, setBarrio] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { tasks: list } = await api.tasks({
        ...(urgentOnly ? { urgent: '1' } : {}),
        ...(barrio.trim() ? { barrio: barrio.trim() } : {}),
      });
      setTasks(list);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [urgentOnly, barrio]);

  useEffect(() => {
    load();
  }, [load]);

  // Recargar al volver de publicar una tarea.
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      setRefreshing(true);
      load();
    });
    return unsub;
  }, [navigation, load]);

  function priceRange(t) {
    if (t.price_min_gs && t.price_max_gs) return `${gs(t.price_min_gs)} – ${gs(t.price_max_gs)}`;
    if (t.price_max_gs) return `Hasta ${gs(t.price_max_gs)}`;
    if (t.price_min_gs) return `Desde ${gs(t.price_min_gs)}`;
    return 'Precio a convenir';
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Chamba 🔨" />
      <View style={[styles.filters, { paddingBottom: spacing.sm }]}>
        <TouchableOpacity
          style={[styles.toggle, urgentOnly && styles.toggleActive]}
          onPress={() => setUrgentOnly(!urgentOnly)}
        >
          <Text style={[styles.toggleText, urgentOnly && styles.toggleTextActive]}>
            ⚡ Lo necesito hoy
          </Text>
        </TouchableOpacity>
        <TextInput
          style={styles.barrioInput}
          placeholder="Barrio…"
          placeholderTextColor={colors.muted}
          value={barrio}
          onChangeText={setBarrio}
          onSubmitEditing={() => load()}
          returnKeyType="search"
        />
      </View>

      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + 96 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : tasks.length === 0 ? (
          <Card>
            <Text style={styles.empty}>
              {urgentOnly
                ? 'No hay tareas urgentes por ahora. Desactivá el filtro para ver todas.'
                : 'No hay tareas abiertas por acá. ¡Publicá la primera!'}
            </Text>
          </Card>
        ) : (
          tasks.map((t) => (
            <Card key={t.id} onPress={() => navigation.navigate('TaskDetail', { taskId: t.id })}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{t.title}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {t.client_name}{t.barrio ? ` — ${t.barrio}` : ''}
                  </Text>
                </View>
                {t.urgent ? (
                  <View style={styles.urgentBadge}>
                    <Text style={styles.urgentText}>⚡ HOY</Text>
                  </View>
                ) : null}
              </View>
              {t.description ? (
                <Text style={styles.desc} numberOfLines={2}>{t.description}</Text>
              ) : null}
              <Text style={styles.price}>{priceRange(t)}</Text>
            </Card>
          ))
        )}
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + spacing.md }]}
        onPress={() => navigation.navigate('PublishTask')}
        activeOpacity={0.9}
      >
        <Text style={styles.fabText}>+ Publicar tarea</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  filters: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.sm },
  toggle: {
    backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 14,
  },
  toggleActive: { backgroundColor: colors.urgent, borderColor: colors.urgent },
  toggleText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
  toggleTextActive: { color: '#fff' },
  barrioInput: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 14,
    fontSize: fontSize.sm, color: colors.text,
  },
  inner: { padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  meta: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  desc: { fontSize: fontSize.sm, color: colors.text, marginTop: 6, lineHeight: 20 },
  price: { fontSize: fontSize.md, fontWeight: '800', color: colors.primary, marginTop: 8 },
  urgentBadge: { backgroundColor: colors.urgent, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 },
  urgentText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '800' },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
  fab: {
    position: 'absolute', right: spacing.md, backgroundColor: colors.primary,
    borderRadius: radius.pill, paddingVertical: 14, paddingHorizontal: 20,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
  },
  fabText: { color: '#fff', fontWeight: '800', fontSize: fontSize.md },
});
