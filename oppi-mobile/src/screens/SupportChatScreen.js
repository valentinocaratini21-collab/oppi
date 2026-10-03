import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { api } from '../api/client';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Detalle de una conversación de soporte (agentes).
 * Burbujas entrantes/salientes; las salientes llevan etiqueta "bot"/"humano".
 * Polling cada 5s para mensajes nuevos. Acciones: responder como humano
 * (envía y pasa a 'human'), devolver al bot, marcar resuelta.
 */

function normalizeMsg(m) {
  const incoming = m.incoming != null ? !!m.incoming : m.from === 'user';
  return {
    id: String(m.id != null ? m.id : Math.random()),
    incoming,
    sender: !incoming && (m.sender === 'human' || m.agent_type === 'human') ? 'human' : null,
    text: m.body != null ? m.body : m.text || '',
    time: m.created_at || m.time || '',
  };
}

function statusLabel(status) {
  if (status === 'bot') return '🤖 Bot';
  if (status === 'human') return '🧑 Humano';
  if (status === 'resolved') return '✅ Resuelta';
  return status || '';
}

export function SupportChatScreen({ navigation, route }) {
  const { conversationId, title, kind, status: initialStatus } = route.params || {};
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(initialStatus || 'bot');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const flatRef = useRef(null);
  const aliveRef = useRef(true);

  const load = useCallback(
    async (silent) => {
      try {
        const { messages: list } = await api.supportMessages(conversationId);
        if (!aliveRef.current) return;
        setMessages((list || []).map(normalizeMsg));
      } catch {
        // el próximo poll reintenta
      } finally {
        if (aliveRef.current && !silent) setLoading(false);
      }
    },
    [conversationId]
  );

  useEffect(() => {
    aliveRef.current = true;
    load(false);
    const t = setInterval(() => load(true), 5000);
    return () => {
      aliveRef.current = false;
      clearInterval(t);
    };
  }, [load]);

  async function sendReply() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api.supportReply(conversationId, body);
      setDraft('');
      setStatus('human');
      await load(true);
      Alert.alert('Respuesta enviada', 'La conversación pasó a modo humano ✅');
    } catch (e) {
      Alert.alert('No se pudo enviar', e.message || 'Revisá tu conexión e intentá de nuevo.');
    } finally {
      setSending(false);
    }
  }

  async function toBot() {
    try {
      await api.supportBot(conversationId);
      setStatus('bot');
      await load(true);
    } catch (e) {
      Alert.alert('No se pudo devolver al bot', e.message || 'Intentá de nuevo.');
    }
  }

  async function resolve() {
    Alert.alert('Marcar como resuelta', '¿Cerramos esta conversación?', [
      { text: 'Todavía no', style: 'cancel' },
      {
        text: 'Sí, resuelta',
        onPress: async () => {
          try {
            await api.supportResolve(conversationId);
            setStatus('resolved');
            await load(true);
          } catch (e) {
            Alert.alert('No se pudo marcar como resuelta', e.message || 'Intentá de nuevo.');
          }
        },
      },
    ]);
  }

  function renderItem({ item }) {
    return (
      <View style={[styles.bubble, item.incoming ? styles.theirs : styles.mine]}>
        {!item.incoming ? (
          <Text style={styles.sender}>{item.sender === 'human' ? '🧑 humano' : '🤖 bot'}</Text>
        ) : null}
        <Text style={[styles.text, !item.incoming && styles.textMine]}>{item.text}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <ScreenHeader
        title={title || 'Soporte'}
        onBack={() => navigation.goBack()}
        right={
          <Text style={styles.statusPill}>
            {kind === 'business' ? '🏢 ' : '👤 '}
            {statusLabel(status)}
          </Text>
        }
      />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : (
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Todavía no hay mensajes.</Text>
            </View>
          }
        />
      )}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} activeOpacity={0.85} onPress={toBot}>
          <Text style={styles.actionText}>Devolver al bot</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} activeOpacity={0.85} onPress={resolve}>
          <Text style={styles.actionText}>Marcar resuelta</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Escribí tu respuesta…"
          placeholderTextColor={colors.muted}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, sending && styles.sendBtnBusy]}
          activeOpacity={0.85}
          onPress={sendReply}
          disabled={sending}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.sendText}>Responder como humano ➤</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  statusPill: { fontSize: fontSize.xs, color: colors.muted },
  list: { padding: spacing.md, flexGrow: 1 },
  bubble: {
    maxWidth: '80%',
    borderRadius: radius.card,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 6,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    borderBottomRightRadius: 6,
  },
  sender: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    opacity: 0.8,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  text: { fontSize: fontSize.md, color: colors.text, lineHeight: 22 },
  textMine: { color: '#fff' },
  empty: { alignItems: 'center', marginTop: spacing.lg * 2 },
  emptyText: { color: colors.muted, fontSize: fontSize.sm },
  actions: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.button,
    paddingVertical: 10,
    alignItems: 'center',
  },
  actionText: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '700' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    maxHeight: 110,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnBusy: { opacity: 0.7 },
  sendText: { color: '#fff', fontSize: fontSize.sm, fontWeight: '800' },
});
