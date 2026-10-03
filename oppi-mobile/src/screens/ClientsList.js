import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { Rating } from '../components/Rating';
import { gs, dateEs } from '../utils';
import { colors, fontSize, spacing } from '../theme';

/**
 * Lista de clientes (compartida por pro y negocio).
 * Props: title, loadClients() → array, detailRoute ('ClientDetail').
 *
 * Buscador por nombre + lista → detalle con historial de reservas.
 */
export function ClientsList({ title, onBack, loadClients, navigation }) {
  const insets = useSafeAreaInsets();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');

  // loadClients puede ser una función inline (nueva en cada render):
  // la guardamos en un ref para no re-disparar el efecto en loop.
  const loadRef = useRef(loadClients);
  loadRef.current = loadClients;

  const load = useCallback(async () => {
    try {
      const list = await loadRef.current();
      setClients(list || []);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar tus clientes.');
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

  const filtered = clients.filter((c) =>
    (c.nombre || '').toLowerCase().includes(q.trim().toLowerCase())
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.muted}>Cargando clientes…</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title={title} onBack={onBack} />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <TextInput
          style={styles.search}
          value={q}
          onChangeText={setQ}
          placeholder="Buscá por nombre…"
          placeholderTextColor={colors.muted}
          returnKeyType="search"
        />

        {clients.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>Todavía no tenés clientes registrados 👥</Text>
            <Text style={styles.emptySub}>
              Cuando alguien reserve con vos por primera vez, aparece acá con su
              historial y cuánto gastó.
            </Text>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>Nadie con ese nombre 🔍</Text>
            <Text style={styles.emptySub}>Probá con otro nombre.</Text>
          </Card>
        ) : (
          filtered.map((c) => (
            <TouchableOpacity
              key={c.id}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('ClientDetail', { client: c })}
            >
              <Card>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{c.nombre || 'Cliente'}</Text>
                    {!!c.barrio && <Text style={styles.meta}>📍 {c.barrio}</Text>}
                  </View>
                  {Number(c.rating_promedio_dado) > 0 && (
                    <Rating value={Number(c.rating_promedio_dado)} />
                  )}
                </View>
                <Text style={styles.stats}>
                  {Number(c.reservas_count || 0)} reserva{Number(c.reservas_count) === 1 ? '' : 's'}
                  {' · '}{gs(c.gasto_total)}
                  {c.ultima_visita ? ` · última: ${dateEs(c.ultima_visita)}` : ''}
                </Text>
                <Text style={styles.link}>Ver detalle →</Text>
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
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: colors.muted },
  inner: { padding: spacing.md },
  search: {
    backgroundColor: colors.card, borderRadius: 12, borderWidth: 1,
    borderColor: colors.border, padding: 14, fontSize: fontSize.md,
    color: colors.text, marginBottom: spacing.sm,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  name: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  meta: { fontSize: fontSize.xs, color: colors.muted, marginTop: 2 },
  stats: { fontSize: fontSize.sm, color: colors.muted, marginTop: spacing.sm },
  link: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '700', marginTop: spacing.sm },
  emptyTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptySub: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 20 },
});
