import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { Rating } from '../components/Rating';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors, fontSize, spacing } from '../theme';

/** Favoritos: profesionales guardados (GET/DELETE /api/favorites). */
export function FavoritesScreen({ navigation }) {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { favorites: f } = await api.favorites();
      setFavorites(f);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar tus favoritos.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  async function remove(id) {
    try {
      await api.removeFavorite(id);
      setFavorites((prev) => prev.filter((f) => f.id !== id));
    } catch (e) {
      Alert.alert('Error', e.message || 'No se pudo quitar de favoritos.');
    }
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Favoritos" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.inner}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : favorites.length === 0 ? (
          <Card>
            <Text style={styles.empty}>No tenés favoritos todavía. Tocá el ♡ en el perfil de un profesional.</Text>
          </Card>
        ) : (
          favorites.map((p) => (
            <Card key={p.id}>
              <TouchableOpacity onPress={() => navigation.navigate('ProDetail', { proId: p.id })}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{p.name}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {(p.categories || []).join(' · ')}{p.barrio ? ` — ${p.barrio}` : ''}
                    </Text>
                    <Rating value={p.rating} />
                  </View>
                  <TouchableOpacity onPress={() => remove(p.id)} hitSlop={12}>
                    <Text style={styles.trash}>🗑</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  meta: { fontSize: fontSize.sm, color: colors.muted, marginVertical: 2 },
  trash: { fontSize: 20, marginLeft: spacing.sm },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
});
