import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Image,
} from 'react-native';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs, label } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Detalle de la tarea: info, ofertas, y según el rol:
 *  - handyman: hacer oferta (POST /api/tasks/:id/offers)
 *  - cliente dueño: aceptar una oferta (POST /api/offers/:id/accept) → crea el job
 *  - chat del trabajo con el otro participante.
 */
export function TaskDetailScreen({ navigation, route }) {
  const { taskId } = route.params;
  const { user, isLoggedIn } = useAuth();
  const [task, setTask] = useState(null);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [sendingOffer, setSendingOffer] = useState(false);
  const [acceptingId, setAcceptingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const { task: t, offers: of } = await api.task(taskId);
      setTask(t);
      setOffers(of || []);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar la tarea.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  const isOwner = user && task && task.client_id === user.id;
  const isHandyman = user?.role === 'handyman';
  const alreadyOffered = isHandyman && offers.some((o) => o.handyman_id === user.id);

  async function sendOffer() {
    if (!isLoggedIn) {
      Alert.alert('Entrá primero', 'Necesitás una cuenta de handyman para ofertar.');
      return;
    }
    const amountGs = parseInt(amount.replace(/[^0-9]/g, ''), 10);
    if (!Number.isInteger(amountGs) || amountGs <= 0) {
      Alert.alert('Monto inválido', 'Pasá un monto en guaraníes mayor a 0.');
      return;
    }
    setSendingOffer(true);
    try {
      await api.createOffer(taskId, { amount_gs: amountGs, message: message.trim() });
      setAmount('');
      setMessage('');
      await load();
    } catch (e) {
      Alert.alert('No pudimos enviar la oferta', e.message || 'Intentá de nuevo.');
    } finally {
      setSendingOffer(false);
    }
  }

  async function acceptOffer(offerId) {
    setAcceptingId(offerId);
    try {
      const { job } = await api.acceptOffer(offerId);
      Alert.alert(
        '¡Oferta aceptada!',
        'Se creó el trabajo. Cuando el handyman lo termine, pagás el total.',
        [{ text: 'Ver trabajo', onPress: () => navigation.navigate('JobDetail', { jobId: job.id }) }, { text: 'OK' }]
      );
      await load();
    } catch (e) {
      Alert.alert('No pudimos aceptar', e.message || 'Intentá de nuevo.');
    } finally {
      setAcceptingId(null);
    }
  }

  async function openChat(otherUserId, otherName) {
    if (!isLoggedIn) {
      Alert.alert('Entrá primero', 'Necesitás una cuenta para escribir.');
      return;
    }
    try {
      const { conversation } = await api.createConversation({
        participants: [otherUserId],
        task_id: taskId,
      });
      navigation.navigate('Chat', { conversationId: conversation.id, title: otherName });
    } catch (e) {
      Alert.alert('Error', e.message || 'No se pudo abrir el chat.');
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!task) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No encontramos esa tarea.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Tarea" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <Card>
          <View style={styles.row}>
            <Text style={[styles.title, { flex: 1 }]}>{task.title}</Text>
            {task.urgent ? (
              <View style={styles.urgentBadge}>
                <Text style={styles.urgentText}>⚡ URGENTE</Text>
              </View>
            ) : null}
          </View>
          {task.description ? <Text style={styles.desc}>{task.description}</Text> : null}
          {task.photos && task.photos.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photosRow}>
              {task.photos.map((p, i) => (
                <Image key={`${i}-${p}`} source={{ uri: p }} style={styles.photo} />
              ))}
            </ScrollView>
          ) : null}
          <Text style={styles.meta}>
            {task.client_name}{task.barrio ? ` — ${task.barrio}` : ''}
            {task.category ? ` · ${task.category}` : ''}
          </Text>
          <Text style={styles.status}>Estado: {label(task.status)}</Text>
        </Card>

        {/* Chat con la otra parte */}
        {isOwner && offers.length > 0 && offers[0].status === 'accepted' && (
          <PrimaryButton
            title="Chatear con el handyman 💬"
            variant="secondary"
            onPress={() => {
              const o = offers.find((x) => x.status === 'accepted');
              openChat(o.handyman_id, o.handyman_name);
            }}
          />
        )}

        <Text style={styles.section}>Ofertas ({offers.length})</Text>
        {offers.length === 0 && (
          <Card>
            <Text style={styles.empty}>Todavía no hay ofertas. {isHandyman ? '¡Sé el primero!' : ''}</Text>
          </Card>
        )}
        {offers.map((o) => (
          <Card key={o.id}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.offerName}>{o.handyman_name}</Text>
                <Text style={styles.offerAmount}>{gs(o.amount_gs)}</Text>
                {o.message ? <Text style={styles.offerMsg}>{o.message}</Text> : null}
                <Text style={styles.offerStatus}>Estado: {label(o.status)}</Text>
              </View>
            </View>
            {isOwner && task.status === 'open' && o.status === 'pending' && (
              <PrimaryButton
                title="Aceptar oferta"
                loading={acceptingId === o.id}
                onPress={() => acceptOffer(o.id)}
                style={{ marginTop: spacing.sm }}
              />
            )}
            {isHandyman && o.handyman_id === user.id && (
              <PrimaryButton
                title="Chatear con el cliente 💬"
                variant="secondary"
                onPress={() => openChat(task.client_id, task.client_name)}
                style={{ marginTop: spacing.sm }}
              />
            )}
          </Card>
        ))}

        {/* Hacer oferta: solo handyman, tarea abierta, sin oferta propia previa */}
        {isHandyman && task.status === 'open' && !isOwner && !alreadyOffered && (
          <Card>
            <Text style={styles.section}>Hacé tu oferta</Text>
            <Text style={styles.label}>Monto en Gs. *</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ''))}
              placeholder="Ej. 150000"
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
            />
            <Text style={styles.label}>Mensaje (opcional)</Text>
            <TextInput
              style={styles.input}
              value={message}
              onChangeText={setMessage}
              placeholder="Contale por qué sos el indicado…"
              placeholderTextColor={colors.muted}
            />
            <PrimaryButton title="Enviar oferta" onPress={sendOffer} loading={sendingOffer} style={{ marginTop: spacing.md }} />
          </Card>
        )}
        {isHandyman && alreadyOffered && task.status === 'open' && (
          <Card>
            <Text style={styles.empty}>Ya enviaste tu oferta. Te avisamos si el cliente la acepta.</Text>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  inner: { padding: spacing.md, paddingBottom: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  desc: { fontSize: fontSize.md, color: colors.text, marginTop: 8, lineHeight: 22 },
  meta: { fontSize: fontSize.sm, color: colors.muted, marginTop: 8 },
  status: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '700', marginTop: 4 },
  section: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  urgentBadge: { backgroundColor: colors.urgent, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 },
  urgentText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '800' },
  photosRow: { marginTop: spacing.sm },
  photo: { width: 110, height: 110, borderRadius: radius.button, marginRight: spacing.sm, backgroundColor: colors.light },
  offerName: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  offerAmount: { fontSize: fontSize.lg, fontWeight: '800', color: colors.primary, marginTop: 2 },
  offerMsg: { fontSize: fontSize.sm, color: colors.text, marginTop: 4, lineHeight: 20 },
  offerStatus: { fontSize: fontSize.xs, color: colors.muted, marginTop: 4 },
  label: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: colors.bg, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 12, fontSize: fontSize.md, color: colors.text,
  },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
});
