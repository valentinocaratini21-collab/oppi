import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { Rating } from '../components/Rating';
import { ReviewPhotos } from '../components/ReviewPhotos';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Reseñas del negocio (ruta "BusinessReviews", params {businessId}).
 * Se leen del detalle del negocio; responder con replyReview (una sola vez).
 * La respuesta queda visible en el perfil público.
 */
export function BusinessReviewsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { businessId } = route.params;
  const [businessName, setBusinessName] = useState('');
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [sendingId, setSendingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const { business, reviews: r } = await api.business(businessId);
      setBusinessName(business?.name || '');
      setReviews(r || []);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar las reseñas.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  async function sendReply(review) {
    const text = (drafts[review.id] || '').trim();
    if (!text) {
      Alert.alert('Respuesta vacía', 'Escribí tu respuesta antes de enviarla.');
      return;
    }
    setSendingId(review.id);
    try {
      await api.replyReview(review.id, text);
      setDrafts((prev) => ({ ...prev, [review.id]: '' }));
      await load();
    } catch (e) {
      Alert.alert('No se pudo responder', e.message || 'Intentá de nuevo.');
    } finally {
      setSendingId(null);
    }
  }

  const avg = reviews.length
    ? reviews.reduce((a, r) => a + Number(r.rating || 0), 0) / reviews.length
    : null;

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Reseñas" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : (
          <>
            <Card style={styles.summary}>
              <Text style={styles.summaryTitle}>
                {avg !== null ? <Rating value={avg} /> : 'Sin reseñas todavía'}
              </Text>
              <Text style={styles.summarySub}>
                {reviews.length === 0
                  ? 'Cuando un cliente te deje una reseña, aparece acá.'
                  : `${reviews.length} reseña${reviews.length === 1 ? '' : 's'} · Respondé: se muestran en tu perfil público.`}
              </Text>
            </Card>

            {reviews.map((r) => (
              <Card key={r.id}>
                <View style={styles.rowBetween}>
                  <Text style={styles.author}>{r.from || 'Cliente'}</Text>
                  <Rating value={r.rating} />
                </View>
                {!!r.text && <Text style={styles.text}>{r.text}</Text>}
                <ReviewPhotos photos={r.photos} />

                {r.reply_text ? (
                  <View style={styles.replyBox}>
                    <Text style={styles.replyTitle}>Tu respuesta:</Text>
                    <Text style={styles.replyText}>{r.reply_text}</Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.replyLabel}>Responder como {businessName || 'tu negocio'}</Text>
                    <TextInput
                      style={styles.input}
                      value={drafts[r.id] || ''}
                      onChangeText={(t) => setDrafts((prev) => ({ ...prev, [r.id]: t }))}
                      placeholder="Gracias por tu visita…"
                      placeholderTextColor={colors.muted}
                      multiline
                    />
                    <PrimaryButton
                      title="Responder"
                      variant="ghost"
                      onPress={() => sendReply(r)}
                      loading={sendingId === r.id}
                      style={{ minHeight: 44, marginTop: spacing.sm }}
                    />
                  </>
                )}
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  summary: { alignItems: 'center' },
  summaryTitle: { fontSize: fontSize.lg, fontWeight: '900', color: colors.text },
  summarySub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 6, textAlign: 'center', lineHeight: 20 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  author: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  text: { fontSize: fontSize.sm, color: colors.text, marginTop: 8, lineHeight: 20 },
  replyBox: {
    marginTop: spacing.sm, backgroundColor: colors.light, borderRadius: radius.button,
    padding: spacing.sm, borderLeftWidth: 3, borderLeftColor: colors.primary,
  },
  replyTitle: { fontSize: fontSize.xs, fontWeight: '800', color: colors.primary },
  replyText: { fontSize: fontSize.sm, color: colors.text, marginTop: 4, lineHeight: 20 },
  replyLabel: { fontSize: fontSize.xs, fontWeight: '700', color: colors.muted, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.bg, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 12, fontSize: fontSize.md, color: colors.text,
    minHeight: 72, textAlignVertical: 'top',
  },
});
