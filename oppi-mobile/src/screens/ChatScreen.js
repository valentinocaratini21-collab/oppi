import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Image,
} from 'react-native';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { pickAndUpload } from '../utils/photos';
import { gs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Chat básico del trabajo: mensajes de texto + fotos + cotizaciones.
 * - Cualquiera puede adjuntar una foto (galería → api.upload → photos[]).
 * - SEPARACIÓN DE ROLES (intacta): solo el handyman crea quotes;
 *   solo el cliente las acepta/rechaza (PATCH /api/messages/:id/quote).
 */
export function ChatScreen({ navigation, route }) {
  const { conversationId, title } = route.params;
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [quoteMode, setQuoteMode] = useState(false);
  const [quoteAmount, setQuoteAmount] = useState('');
  const [quoteDetail, setQuoteDetail] = useState('');
  // Foto adjunta pendiente de enviar (file ya subido: { url, filename, ... }).
  const [pendingPhoto, setPendingPhoto] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { messages: list } = await api.messages(conversationId);
      setMessages(list);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar los mensajes.');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000); // polling liviano
    return () => clearInterval(t);
  }, [load]);

  async function attachPhoto() {
    setPhotoBusy(true);
    try {
      const result = await pickAndUpload({ quality: 0.8 });
      if (!result.canceled && result.file?.url) {
        setPendingPhoto(result.file);
      }
    } catch (e) {
      Alert.alert('No pudimos subir la foto', e.message || 'Intentá de nuevo.');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function send() {
    if (!text.trim() && !quoteMode && !pendingPhoto) return;
    let payload = { text: text.trim() };
    if (pendingPhoto) {
      payload.photos = [{ filename: pendingPhoto.filename || 'foto.jpg', url: pendingPhoto.url }];
    }
    if (quoteMode) {
      const amountGs = parseInt(quoteAmount.replace(/[^0-9]/g, ''), 10);
      if (!Number.isInteger(amountGs) || amountGs <= 0) {
        Alert.alert('Monto inválido', 'La cotización necesita un monto en guaraníes mayor a 0.');
        return;
      }
      payload = { text: text.trim(), quote: { amount_gs: amountGs, detail: quoteDetail.trim() } };
    }
    setSending(true);
    try {
      const { message: m } = await api.sendMessage(conversationId, payload);
      setMessages((prev) => [...prev, m]);
      setText('');
      setQuoteAmount('');
      setQuoteDetail('');
      setQuoteMode(false);
      setPendingPhoto(null);
    } catch (e) {
      Alert.alert('No se pudo enviar', e.message || 'Intentá de nuevo.');
    } finally {
      setSending(false);
    }
  }

  async function answerQuote(messageId, status) {
    try {
      const { quote } = await api.answerQuote(messageId, status);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.quote ? { ...m, quote } : m
        )
      );
    } catch (e) {
      Alert.alert('Error', e.message || 'No se pudo responder la cotización.');
    }
  }

  function renderItem({ item }) {
    const mine = item.sender_id === user?.id;
    const q = item.quote;
    const photos = (item.photos || []).filter((p) => p && p.url);
    return (
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
        {!mine && <Text style={styles.sender}>{item.sender_name}</Text>}
        {photos.length > 0 && (
          <View style={styles.photos}>
            {photos.map((p, i) => (
              <Image key={`${p.url}-${i}`} source={{ uri: p.url }} style={styles.thumb} />
            ))}
          </View>
        )}
        {item.text ? <Text style={[styles.msgText, mine && styles.msgTextMine]}>{item.text}</Text> : null}
        {q && (
          <View style={styles.quoteBox}>
            <Text style={styles.quoteTitle}>💰 Cotización: {gs(q.amount_gs)}</Text>
            {q.detail ? <Text style={styles.quoteDetail}>{q.detail}</Text> : null}
            <Text style={styles.quoteStatus}>
              {q.status === 'pending' ? 'Pendiente de respuesta' : q.status === 'accepted' ? '✅ Aceptada' : '❌ Rechazada'}
            </Text>
            {q.status === 'pending' && user?.role === 'client' && !mine && (
              <View style={styles.quoteActions}>
                <TouchableOpacity style={[styles.quoteBtn, styles.accept]} onPress={() => answerQuote(item.id, 'accepted')}>
                  <Text style={styles.quoteBtnText}>Aceptar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.quoteBtn, styles.reject]} onPress={() => answerQuote(item.id, 'rejected')}>
                  <Text style={styles.quoteBtnText}>Rechazar</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <ScreenHeader title={title || 'Chat'} onBack={() => navigation.goBack()} />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => String(m.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>Todavía no hay mensajes. ¡Saludá primero! 👋</Text>
          }
        />
      )}

      {user?.role === 'handyman' && (
        <TouchableOpacity style={styles.quoteToggle} onPress={() => setQuoteMode(!quoteMode)}>
          <Text style={styles.quoteToggleText}>
            {quoteMode ? '✕ Cancelar cotización' : '💰 Enviar cotización'}
          </Text>
        </TouchableOpacity>
      )}

      {quoteMode && (
        <View style={styles.quoteForm}>
          <TextInput
            style={styles.input}
            value={quoteAmount}
            onChangeText={(t) => setQuoteAmount(t.replace(/[^0-9]/g, ''))}
            placeholder="Monto en Gs."
            placeholderTextColor={colors.muted}
            keyboardType="numeric"
          />
          <TextInput
            style={styles.input}
            value={quoteDetail}
            onChangeText={setQuoteDetail}
            placeholder="Detalle (opcional)"
            placeholderTextColor={colors.muted}
          />
        </View>
      )}

      {pendingPhoto && (
        <View style={styles.pendingPhotoWrap}>
          <Image source={{ uri: pendingPhoto.url }} style={styles.pendingThumb} />
          <TouchableOpacity style={styles.pendingRemove} onPress={() => setPendingPhoto(null)} hitSlop={10}>
            <Text style={styles.pendingRemoveText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.composer}>
        <TouchableOpacity
          style={styles.attach}
          onPress={attachPhoto}
          disabled={photoBusy || sending}
          accessibilityLabel="Adjuntar foto"
        >
          <Text style={styles.attachText}>{photoBusy ? '…' : '📎'}</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.composerInput}
          value={text}
          onChangeText={setText}
          placeholder="Escribí un mensaje…"
          placeholderTextColor={colors.muted}
          onSubmitEditing={send}
        />
        <TouchableOpacity style={styles.send} onPress={send} disabled={sending}>
          <Text style={styles.sendText}>{sending ? '…' : '➤'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.md, paddingBottom: spacing.md },
  bubble: {
    maxWidth: '80%', borderRadius: radius.card, padding: 12, marginBottom: 8,
  },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  sender: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary, marginBottom: 4 },
  msgText: { fontSize: fontSize.md, color: colors.text },
  msgTextMine: { color: '#fff' },
  quoteBox: { marginTop: 8, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: radius.button, padding: 10 },
  quoteTitle: { fontWeight: '800', fontSize: fontSize.md, color: colors.text },
  quoteDetail: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  quoteStatus: { fontSize: fontSize.sm, fontWeight: '700', color: colors.primary, marginTop: 6 },
  quoteActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  quoteBtn: { flex: 1, borderRadius: radius.button, padding: 10, alignItems: 'center' },
  accept: { backgroundColor: colors.success },
  reject: { backgroundColor: colors.danger },
  quoteBtnText: { color: '#fff', fontWeight: '700' },
  quoteToggle: { padding: spacing.sm, alignItems: 'center' },
  quoteToggleText: { color: colors.primary, fontWeight: '700', fontSize: fontSize.sm },
  quoteForm: { paddingHorizontal: spacing.md, gap: 8, paddingBottom: 8 },
  input: {
    backgroundColor: colors.card, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 12, fontSize: fontSize.md, color: colors.text,
  },
  composer: {
    flexDirection: 'row', alignItems: 'center', padding: spacing.sm,
    backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border,
  },
  attach: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.light,
    alignItems: 'center', justifyContent: 'center', marginRight: 8,
  },
  attachText: { fontSize: 20 },
  pendingPhotoWrap: {
    flexDirection: 'row', alignItems: 'center', padding: spacing.sm,
    backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border,
  },
  pendingThumb: { width: 64, height: 64, borderRadius: radius.button },
  pendingRemove: {
    marginLeft: 8, width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  pendingRemoveText: { color: colors.text, fontWeight: '800', fontSize: fontSize.sm },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  thumb: { width: 140, height: 140, borderRadius: radius.button, backgroundColor: colors.border },
  composerInput: {
    flex: 1, backgroundColor: colors.bg, borderRadius: radius.pill,
    paddingVertical: 10, paddingHorizontal: 16, fontSize: fontSize.md, color: colors.text,
  },
  send: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginLeft: 8,
  },
  sendText: { color: '#fff', fontSize: 18 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: spacing.lg },
});
