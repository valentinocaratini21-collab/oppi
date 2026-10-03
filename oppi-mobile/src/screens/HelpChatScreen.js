import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Ayuda y soporte: el soporte de Oppi vive DENTRO de la app (chat integrado
 * con bot), no en WhatsApp.
 *
 * - Burbujas: usuario a la derecha en violeta (#6B5BD0), bot/agente a la
 *   izquierda en tarjeta blanca. Los mensajes de agente llevan la etiqueta
 *   "Soporte Oppi".
 * - quick_replies del backend → chips tocables en horizontal.
 * - Indicador "escribiendo…" mientras se espera la respuesta del bot.
 * - Handoff: cuando el backend responde status 'human', aviso
 *   "Te paso con un asesor 👌" (una sola vez por conversación).
 * - Polling cada 5s a GET /api/support/chat/history para respuestas del
 *   asesor; el intervalo se limpia al desmontar.
 * - El backend todavía no expone /api/support/chat*: si falla, la pantalla
 *   muestra un aviso con botón "Reintentar" y el input sigue funcionando.
 */

const WELCOME = {
  key: 'welcome',
  sender: 'bot',
  body: '¡Hola! 👋 Soy el asistente de Oppi. Preguntame lo que quieras sobre tus reservas, pagos, cancelaciones o tu negocio.',
  created_at: '',
  kind: 'msg',
};

function msgKey(m) {
  return `${m.created_at || ''}|${m.sender || ''}|${m.body || ''}`;
}

export function HelpChatScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState([]);
  const [quickReplies, setQuickReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const flatRef = useRef(null);
  const aliveRef = useRef(true);
  const seenRef = useRef(new Set());

  const remember = useCallback((list) => {
    list.forEach((m) => {
      const k = m.key || msgKey(m);
      if (!seenRef.current.has(k)) seenRef.current.add(k);
    });
  }, []);

  const mergeHistory = useCallback(
    (historyList) => {
      if (!aliveRef.current) return;
      const fresh = [];
      (historyList || []).forEach((m, i) => {
        const item = {
          key: `h-${msgKey(m)}-${i}`,
          sender: m.sender === 'user' ? 'user' : m.sender === 'agent' ? 'agent' : 'bot',
          body: m.body || '',
          created_at: m.created_at || '',
          kind: 'msg',
        };
        const k = msgKey(item);
        // Evita duplicar mensajes de usuario optimistas ya mostrados (mismo
        // cuerpo enviado hace < 3 min desde este dispositivo).
        if (item.sender === 'user' && item.created_at) {
          const age = Date.now() - new Date(item.created_at).getTime();
          if (age < 3 * 60 * 1000 && seenRef.current.has(`localuser|${item.body}`)) return;
        }
        if (seenRef.current.has(k)) return;
        seenRef.current.add(k);
        fresh.push(item);
      });
      if (fresh.length) {
        setMessages((prev) => [...prev, ...fresh]);
      }
      return fresh.length;
    },
    []
  );

  const load = useCallback(
    async (silent) => {
      try {
        const data = await api.supportHistory();
        if (!aliveRef.current) return;
        const fresh = mergeHistory(data.messages || data || []);
        if (fresh > 0) {
          // Si el asesor respondió, el handoff ya se vio (no repetir el aviso).
          const agentMsg = (data.messages || []).some((m) => m.sender === 'agent');
          if (agentMsg) setHandedOff(true);
        }
        setLoadError('');
      } catch (e) {
        if (aliveRef.current && !silent) setLoadError(e.message || 'No pudimos cargar el chat.');
      } finally {
        if (aliveRef.current && !silent) setLoading(false);
      }
    },
    [mergeHistory]
  );

  useEffect(() => {
    aliveRef.current = true;
    seenRef.current = new Set();
    setMessages([WELCOME]);
    remember([WELCOME]);
    load(false);
    const t = setInterval(() => load(true), 5000);
    return () => {
      aliveRef.current = false;
      clearInterval(t);
    };
  }, [load, remember]);

  async function send(bodyOverride) {
    const body = (bodyOverride ?? draft).trim();
    if (!body || sending) return;
    setSending(true);
    setQuickReplies([]);
    const userMsg = {
      key: `local-${Date.now()}`,
      sender: 'user',
      body,
      created_at: new Date().toISOString(),
      kind: 'msg',
    };
    setMessages((prev) => [...prev, userMsg]);
    seenRef.current.add(`localuser|${body}`);
    if (bodyOverride === undefined) setDraft('');
    setTyping(true);
    try {
      const res = await api.supportChat(body);
      if (!aliveRef.current) return;
      const next = [];
      if (res.status === 'human' && !handedOff) {
        setHandedOff(true);
        next.push({
          key: `notice-handoff-${Date.now()}`,
          sender: 'system',
          body: 'Te paso con un asesor 👌',
          created_at: '',
          kind: 'notice',
        });
      }
      if (res.reply) {
        next.push({
          key: `bot-${Date.now()}`,
          sender: res.status === 'human' ? 'agent' : 'bot',
          body: res.reply,
          created_at: new Date().toISOString(),
          kind: 'msg',
        });
      }
      if (next.length) {
        setMessages((prev) => [...prev, ...next]);
        remember(next);
      }
      if (Array.isArray(res.quick_replies)) setQuickReplies(res.quick_replies);
      setLoadError('');
    } catch (e) {
      if (!aliveRef.current) return;
      setMessages((prev) => [
        ...prev,
        {
          key: `err-${Date.now()}`,
          sender: 'system',
          body: `No pudimos enviar tu mensaje: ${e.message || 'revisá tu conexión'}. Probá de nuevo.`,
          created_at: '',
          kind: 'notice',
        },
      ]);
    } finally {
      if (aliveRef.current) {
        setTyping(false);
        setSending(false);
      }
    }
  }

  function renderItem({ item }) {
    if (item.kind === 'notice') {
      return (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{item.body}</Text>
        </View>
      );
    }
    const mine = item.sender === 'user';
    return (
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
        {item.sender === 'agent' ? <Text style={styles.agentLabel}>Soporte Oppi</Text> : null}
        <Text style={[styles.text, mine && styles.textMine]}>{item.body}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <ScreenHeader title="Ayuda y soporte" onBack={() => navigation.goBack()} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.muted}>Abriendo el chat…</Text>
        </View>
      ) : (
        <>
          {loadError ? (
            <View style={styles.errorBar}>
              <Text style={styles.errorText}>⚠️ {loadError}</Text>
              <TouchableOpacity onPress={() => load(false)} style={styles.retryBtn} activeOpacity={0.85}>
                <Text style={styles.retryText}>Reintentar</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <FlatList
            ref={flatRef}
            data={messages}
            keyExtractor={(m) => m.key}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: true })}
            ListFooterComponent={
              typing ? (
                <View style={[styles.bubble, styles.theirs]}>
                  <Text style={styles.typingText}>escribiendo…</Text>
                </View>
              ) : null
            }
          />
          {quickReplies.length > 0 && (
            <View style={styles.chipsWrap}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {quickReplies.map((q, i) => (
                  <TouchableOpacity
                    key={`qr-${i}`}
                    style={styles.chip}
                    activeOpacity={0.85}
                    onPress={() => send(q)}
                  >
                    <Text style={styles.chipText}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          <View style={[styles.inputRow, { paddingBottom: insets.bottom + spacing.sm }]}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Escribí tu consulta…"
              placeholderTextColor={colors.muted}
              multiline
              maxLength={1000}
              returnKeyType="send"
              onSubmitEditing={() => send()}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
              activeOpacity={0.85}
              onPress={() => send()}
              disabled={sending || !draft.trim()}
            >
              {sending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.sendText}>Enviar ➤</Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: colors.muted, fontSize: fontSize.sm },
  list: { padding: spacing.md, flexGrow: 1 },
  bubble: {
    maxWidth: '80%',
    borderRadius: radius.card,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary, // violeta #6B5BD0
    borderBottomRightRadius: 6,
  },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 6,
  },
  agentLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  text: { fontSize: fontSize.md, color: colors.text, lineHeight: 22 },
  textMine: { color: '#fff' },
  notice: {
    alignSelf: 'center',
    backgroundColor: colors.light,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  noticeText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary },
  typingText: { fontSize: fontSize.sm, color: colors.muted, fontStyle: 'italic' },
  chipsWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  chips: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 8 },
  chip: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  chipText: { color: colors.primary, fontWeight: '700', fontSize: fontSize.sm },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16, // iOS no hace zoom con 16px+
    color: colors.text,
    maxHeight: 110,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.45 },
  sendText: { color: '#fff', fontSize: fontSize.sm, fontWeight: '800' },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: '#F5C6C6',
    borderRadius: radius.card,
    padding: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  errorText: { flex: 1, fontSize: fontSize.sm, color: colors.danger, lineHeight: 18 },
  retryBtn: {
    backgroundColor: colors.danger,
    borderRadius: radius.button,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  retryText: { color: '#fff', fontWeight: '800', fontSize: fontSize.sm },
});
