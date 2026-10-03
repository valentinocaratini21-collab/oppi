import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { api } from '../api/client';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Centro de notificaciones del cliente.
 * Lista (más recientes primero), pull-to-refresh, tocar marca como leída.
 */
const TYPE_ICON = {
  reminder: '⏰',
  review_request: '⭐',
  waitlist: '📋',
  booking: '📅',
  referral: '🎁',
  offer: '💼',
  quote: '💰',
  job: '🔨',
  review: '✍️',
};

function timeAgo(createdAt) {
  try {
    const d = new Date(String(createdAt).replace(' ', 'T'));
    const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
    if (mins < 1) return 'recién';
    if (mins < 60) return `hace ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `hace ${days} d`;
    return d.toLocaleDateString('es-PY', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

export function NotificationsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { notifications } = await api.notifications();
      setItems(notifications || []);
    } catch {
      // queda la lista anterior
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

  async function openNotif(n) {
    if (!n.read) {
      try {
        await api.markNotificationRead(n.id, true);
      } catch {
        // igual la marcamos local para no trabar la UI
      }
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
  }

  function renderItem({ item }) {
    return (
      <TouchableOpacity
        style={[styles.card, !item.read && styles.unreadCard]}
        onPress={() => openNotif(item)}
        activeOpacity={0.85}
      >
        <View style={styles.icon}>
          <Text style={styles.iconText}>{TYPE_ICON[item.type] || '🔔'}</Text>
        </View>
        <View style={styles.body}>
          <View style={styles.head}>
            <Text style={[styles.title, !item.read && styles.titleUnread]} numberOfLines={2}>
              {item.title}
            </Text>
            {!item.read && <View style={styles.dot} />}
          </View>
          {item.body ? (
            <Text style={styles.bodyText} numberOfLines={3}>
              {item.body}
            </Text>
          ) : null}
          <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
        </View>
      </TouchableOpacity>
    );
  }

  const unread = items.filter((n) => !n.read).length;

  return (
    <View style={styles.wrap}>
      <ScreenHeader
        title="Notificaciones"
        onBack={() => navigation.goBack()}
        right={
          unread > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unread}</Text>
            </View>
          ) : null
        }
      />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => String(n.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>🔔</Text>
              <Text style={styles.emptyTitle}>No tenés notificaciones todavía</Text>
              <Text style={styles.emptySub}>
                Cuando reserves, te coticen o se libere un turno, te avisamos acá.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.md, flexGrow: 1 },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unreadCard: { borderColor: colors.primary, backgroundColor: colors.light },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  iconText: { fontSize: 22 },
  body: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { fontSize: fontSize.md, fontWeight: '600', color: colors.text, flex: 1 },
  titleUnread: { fontWeight: '800' },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginLeft: 8,
    marginTop: 5,
  },
  bodyText: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4, lineHeight: 19 },
  time: { fontSize: fontSize.xs, color: colors.muted, marginTop: 6 },
  badge: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    minWidth: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  badgeText: { color: '#fff', fontWeight: '800', fontSize: fontSize.sm },
  emptyWrap: { alignItems: 'center', marginTop: spacing.lg * 2, paddingHorizontal: spacing.lg },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginTop: spacing.md },
  emptySub: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});
