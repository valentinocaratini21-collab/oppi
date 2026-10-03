import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { Card } from '../components/Card';
import { Rating } from '../components/Rating';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Home: saludo con el nombre, buscador, categorías, recomendados
 * y tarjeta "¿Querés ganar plata? 🔨".
 */
const CATEGORIES = [
  { label: 'Peluquería', value: 'peluquería', emoji: '💇' },
  { label: 'Barbería', value: 'barbería', emoji: '💈' },
  { label: 'Electricidad', value: 'electricidad', emoji: '⚡' },
  { label: 'Plomería', value: 'plomería', emoji: '🔧' },
  { label: 'Limpieza', value: 'limpieza', emoji: '✨' },
  { label: 'Manicura', value: 'manicura', emoji: '💅' },
  { label: 'Maquillaje', value: 'maquillaje', emoji: '💄' },
  { label: 'Masajes', value: 'masajes', emoji: '💆' },
];

export function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const [pros, setPros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { professionals } = await api.professionals();
      setPros(professionals.slice(0, 8));
    } catch {
      // Se muestra el estado vacío; el pull-to-refresh reintenta.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const firstName = (user?.name || 'che').split(' ')[0];

  return (
    <ScrollView
      style={[styles.wrap, { paddingTop: insets.top }]}
      contentContainerStyle={styles.inner}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <Text style={styles.greeting}>Hola, {firstName} 👋</Text>
      {/* Ubicación visible (regla del dueño): el barrio del usuario, o Asunción por defecto */}
      <TouchableOpacity
        style={styles.locationRow}
        onPress={() => navigation.navigate('Buscar')}
        activeOpacity={0.8}
      >
        <Text style={styles.locationText}>📍 {user?.barrio || 'Asunción'}</Text>
        <Text style={styles.locationChange}>cambiar</Text>
      </TouchableOpacity>
      <Text style={styles.sub}>¿Qué necesitás hoy?</Text>

      <TextInput
        style={styles.search}
        placeholder="Buscá peluquera, electricista, barrio…"
        placeholderTextColor={colors.muted}
        value={q}
        onChangeText={setQ}
        onSubmitEditing={() => navigation.navigate('Buscar', { q })}
        returnKeyType="search"
      />

      <Text style={styles.section}>Categorías</Text>
      <View style={styles.chips}>
        {CATEGORIES.map((c) => (
          <TouchableOpacity
            key={c.value}
            style={styles.chip}
            onPress={() => navigation.navigate('Buscar', { category: c.value })}
          >
            <Text style={styles.chipEmoji}>{c.emoji}</Text>
            <Text style={styles.chipText}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tarjeta: publicar chamba (lado cliente del marketplace) */}
      <TouchableOpacity
        style={styles.earnCard}
        activeOpacity={0.9}
        onPress={() => navigation.navigate('PublishTask')}
      >
        <Text style={styles.earnTitle}>¿Necesitás una mano? 🙋</Text>
        <Text style={styles.earnSub}>
          Publicá tu chamba y recibí ofertas de handymen verificados cerca tuyo.
        </Text>
        <Text style={styles.earnCta}>Publicar chamba →</Text>
      </TouchableOpacity>

      <View style={styles.rowBetween}>
        <Text style={styles.section}>Recomendados para vos</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Buscar')}>
          <Text style={styles.link}>Ver todos</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : pros.length === 0 ? (
        <Card>
          <Text style={styles.empty}>Todavía no hay profesionales cargados. Deslizá para reintentar.</Text>
        </Card>
      ) : (
        pros.map((p) => (
          <Card key={p.id} onPress={() => navigation.navigate('ProDetail', { proId: p.id })}>
            <View style={styles.proRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(p.name || '?').charAt(0)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.proName}>
                  {p.name} {p.verified ? <Text style={styles.verified}>✓</Text> : null}
                </Text>
                <Text style={styles.proMeta} numberOfLines={1}>
                  {(p.categories || []).join(' · ')}{p.barrio ? ` — ${p.barrio}` : ''}
                </Text>
                <Rating value={p.rating} />
              </View>
              <Text style={styles.chevron}>›</Text>
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md, paddingBottom: spacing.lg },
  greeting: { fontSize: fontSize.xl, fontWeight: '900', color: colors.text },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 2 },
  locationText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary },
  locationChange: { fontSize: fontSize.xs, color: colors.muted, marginLeft: 8, textDecorationLine: 'underline' },
  sub: { fontSize: fontSize.md, color: colors.muted, marginTop: 2, marginBottom: spacing.md },
  search: {
    backgroundColor: colors.card,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    fontSize: fontSize.md,
    color: colors.text,
    marginBottom: spacing.md,
  },
  section: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginVertical: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chipEmoji: { fontSize: fontSize.md, marginRight: 6 },
  chipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  earnCard: {
    backgroundColor: colors.primary,
    borderRadius: radius.card,
    padding: spacing.lg,
    marginVertical: spacing.md,
  },
  earnTitle: { fontSize: fontSize.lg, fontWeight: '800', color: '#fff' },
  earnSub: { fontSize: fontSize.sm, color: '#E6E3FA', marginTop: 6, lineHeight: 20 },
  earnCta: { fontSize: fontSize.md, fontWeight: '800', color: '#fff', marginTop: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: colors.primary, fontWeight: '700', fontSize: fontSize.sm },
  proRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  avatarText: { fontSize: fontSize.lg, fontWeight: '800', color: colors.primary },
  proName: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  verified: { color: colors.success, fontSize: fontSize.sm },
  proMeta: { fontSize: fontSize.sm, color: colors.muted, marginVertical: 2 },
  chevron: { fontSize: 22, color: colors.muted, marginLeft: spacing.sm },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
});
