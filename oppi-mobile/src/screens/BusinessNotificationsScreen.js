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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors, fontSize, spacing } from '../theme';

/** Notificaciones del negocio (ruta "BusinessNotifications"). */
export function BusinessNotificationsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { notifications } = await api.notifications();
      setItems(notifications || []);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar las notificaciones.');
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

  async function markRead(n) {
    if (n.read) return;
    try {
      await api.markNotificationRead(n.id, true);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    } catch {
      // No bloquea la lectura.
    }
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Notificaciones" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : items.length === 0 ? (
          <Card>
            <Text style={styles.empty}>Sin notificaciones por ahora.</Text>
          </Card>
        ) : (
          items.map((n) => (
            <TouchableOpacity key={n.id} onPress={() => markRead(n)}>
              <Card style={!n.read && styles.unread}>
                <Text style={[styles.title, !n.read && styles.titleUnread]}>{n.title}</Text>
                {!!n.body && <Text style={styles.body}>{n.body}</Text>}
              </Card>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
  unread: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  title: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  titleUnread: { fontWeight: '800' },
  body: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4, lineHeight: 20 },
});
