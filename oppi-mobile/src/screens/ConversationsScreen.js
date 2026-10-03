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
import { useAuth } from '../store/AuthContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Lista de conversaciones del cliente (GET /api/conversations).
 * Cada fila se enriquece con el último mensaje para mostrar
 * avatar/nombre, preview y hora → navega a `Chat`.
 *
 * Nota: el backend no expone leídos/no leídos de mensajes, así que
 * la lista no muestra badges de no leídos.
 */
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

export function ConversationsScreen({ navigation }) {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { conversations } = await api.conversations();
      const enriched = await Promise.all(
        (conversations || []).map(async (c) => {
          let last = null;
          let otherName = null;
          try {
            const { messages } = await api.messages(c.id);
            const list = messages || [];
            last = list[list.length - 1] || null;
            const other = list.find((m) => m.sender_id !== user?.id);
            otherName = other?.sender_name || last?.sender_name || null;
          } catch {
            // si falla el detalle, la conversación igual aparece
          }
          return { ...c, last, otherName };
        })
      );
      // Más recientes primero por último mensaje (o por creación).
      enriched.sort((a, b) =>
        String(b.last?.created_at || b.created_at).localeCompare(
          String(a.last?.created_at || a.created_at)
        )
      );
      setRows(enriched);
    } catch {
      // queda la lista anterior
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  function preview(c) {
    const m = c.last;
    if (!m) return 'Tocá para empezar el chat';
    if (m.text) return m.text;
    if (m.photos && m.photos.length) return '📷 Foto';
    if (m.quote) return `💰 Cotización: Gs. ${Number(m.quote.amount_gs || 0).toLocaleString('es-PY')}`;
    return 'Tocá para ver el chat';
  }

  function renderItem({ item }) {
    const name = item.otherName || 'Chat';
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() =>
          navigation.navigate('Chat', { conversationId: item.id, title: name })
        }
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(name || '?').charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.body}>
          <View style={styles.head}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.time}>{item.last ? timeAgo(item.last.created_at) : ''}</Text>
          </View>
          <Text style={styles.preview} numberOfLines={2}>
            {preview(item)}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Mensajes" onBack={() => navigation.goBack()} />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(c) => String(c.id)}
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
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyTitle}>No tenés conversaciones todavía</Text>
              <Text style={styles.emptySub}>
                Cuando le escribas a un profesional o te coticen una changa, el chat aparece acá.
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
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
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
  body: { flex: 1 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: fontSize.md, fontWeight: '700', color: colors.text, flex: 1 },
  time: { fontSize: fontSize.xs, color: colors.muted, marginLeft: 8 },
  preview: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  chevron: { fontSize: 22, color: colors.muted, marginLeft: 8 },
  emptyWrap: { alignItems: 'center', marginTop: spacing.lg * 2, paddingHorizontal: spacing.lg },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginTop: spacing.md },
  emptySub: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});
