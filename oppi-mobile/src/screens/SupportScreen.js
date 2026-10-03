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
import { api, ApiError } from '../api/client';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Bandeja de soporte (agentes): conversaciones de WhatsApp.
 * GET /api/support/conversations?status= — el backend responde 403 si no
 * sos agente: se muestra "No tenés acceso a la bandeja de soporte".
 * Filtros: Todas / Bot / Humano / Resueltas. Badge de no leídas e icono
 * de cliente (👤) vs empresa (🏢).
 */

const FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'bot', label: '🤖 Bot' },
  { id: 'human', label: '🧑 Humano' },
  { id: 'resolved', label: '✅ Resueltas' },
];

function timeAgo(updatedAt) {
  try {
    const d = new Date(String(updatedAt).replace(' ', 'T'));
    const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
    if (mins < 1) return 'ahora';
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

function statusLabel(status) {
  if (status === 'bot') return '🤖 Bot';
  if (status === 'human') return '🧑 Humano';
  if (status === 'resolved') return '✅ Resuelta';
  return status || '';
}

export function SupportScreen({ navigation }) {
  const [filter, setFilter] = useState('all');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [denied, setDenied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [waNote, setWaNote] = useState(false);

  const load = useCallback(async () => {
    try {
      const { conversations } = await api.supportConversations(
        filter === 'all' ? {} : { status: filter }
      );
      const list = conversations || [];
      list.sort((a, b) =>
        String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
      );
      setRows(list);
      setDenied(false);
      setFailed(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setDenied(true);
      else setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  // Nota "Vista previa" si el backend está en modo mock (o no hay backend).
  useEffect(() => {
    let alive = true;
    api
      .whatsappStatus()
      .then((st) => {
        if (alive) setWaNote(!!(st && st.mode === 'mock'));
      })
      .catch(() => {
        // Sin endpoint: se omite la nota. Si la lista falló por conexión,
        // probablemente no hay backend real: mostrarla igual.
        if (alive) setWaNote(failed);
      });
    return () => {
      alive = false;
    };
  }, [failed]);

  function renderItem({ item }) {
    const name = item.user_name || (item.kind === 'business' ? 'Empresa' : 'Cliente');
    const unread = Number(item.unread_count || item.unread || 0);
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() =>
          navigation.navigate('SupportChat', {
            conversationId: item.id,
            title: name,
            kind: item.kind,
            status: item.status,
          })
        }
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{item.kind === 'business' ? '🏢' : '👤'}</Text>
        </View>
        <View style={styles.body}>
          <View style={styles.head}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.time}>{item.updated_at ? timeAgo(item.updated_at) : ''}</Text>
          </View>
          <Text style={styles.preview} numberOfLines={2}>
            {item.last_message || ''}
          </Text>
          <Text style={styles.status}>{statusLabel(item.status)}</Text>
        </View>
        {unread > 0 ? (
          <View style={styles.unread}>
            <Text style={styles.unreadText}>{unread > 9 ? '9+' : String(unread)}</Text>
          </View>
        ) : (
          <Text style={styles.chevron}>›</Text>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Soporte" onBack={() => navigation.goBack()} />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : denied ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🔒</Text>
          <Text style={styles.emptyTitle}>No tenés acceso a la bandeja de soporte</Text>
          <Text style={styles.emptySub}>Esta sección es solo para agentes de soporte de Oppi.</Text>
        </View>
      ) : failed && rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📡</Text>
          <Text style={styles.emptyTitle}>No pudimos cargar la bandeja</Text>
          <Text style={styles.emptySub}>Revisá tu conexión e intentá de nuevo.</Text>
        </View>
      ) : (
        <>
          {waNote ? (
            <View style={styles.waNote}>
              <Text style={styles.waNoteText}>
                📱 <Text style={{ fontWeight: '800' }}>Vista previa</Text> — conectá tu número en
                WHATSAPP.md
              </Text>
            </View>
          ) : null}
          <View style={styles.filters}>
            {FILTERS.map((f) => (
              <TouchableOpacity
                key={f.id}
                style={[styles.chip, filter === f.id && styles.chipActive]}
                activeOpacity={0.85}
                onPress={() => setFilter(f.id)}
              >
                <Text style={[styles.chipText, filter === f.id && styles.chipTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
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
              <View style={styles.center}>
                <Text style={styles.emptyIcon}>💬</Text>
                <Text style={styles.emptyTitle}>No hay conversaciones en este filtro</Text>
              </View>
            }
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', marginTop: spacing.lg * 2, paddingHorizontal: spacing.lg },
  emptyIcon: { fontSize: 48 },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  waNote: {
    backgroundColor: '#FFF8E7',
    borderWidth: 1.5,
    borderColor: '#F5D67B',
    borderRadius: radius.card,
    padding: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  waNoteText: { fontSize: fontSize.sm, color: colors.text },
  filters: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    gap: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, color: colors.muted, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  list: { padding: spacing.md, paddingTop: 4, flexGrow: 1 },
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
  avatarText: { fontSize: 24 },
  body: { flex: 1 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: fontSize.md, fontWeight: '700', color: colors.text, flex: 1 },
  time: { fontSize: fontSize.xs, color: colors.muted, marginLeft: 8 },
  preview: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  status: { fontSize: fontSize.xs, color: colors.muted, marginTop: 4 },
  chevron: { fontSize: 22, color: colors.muted, marginLeft: 8 },
  unread: {
    backgroundColor: colors.primary,
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  unreadText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '800' },
});
