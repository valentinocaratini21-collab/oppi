import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { ScreenHeader } from '../components/ScreenHeader';
import { Card } from '../components/Card';
import { colors, fontSize, spacing } from '../theme';

/**
 * Preferencias de notificaciones (ruta "NotificationPrefs").
 * Mi perfil → "Notificaciones". Cuatro switches que se guardan vía
 * PATCH /api/me/notification-prefs al tocarlos.
 */
const PREFS = [
  {
    key: 'reminders',
    title: 'Recordatorios',
    desc: 'Confirmaciones de reserva, recordatorios de tus turnos y cambios de horario.',
  },
  {
    key: 'offers',
    title: 'Ofertas',
    desc: 'Promociones y descuentos de los negocios y profesionales que seguís.',
  },
  {
    key: 'messages',
    title: 'Mensajes',
    desc: 'Avisos de nuevos mensajes en tus chats y cotizaciones.',
  },
  {
    key: 'promos',
    title: 'Promos',
    desc: 'Novedades de Oppi, beneficios y funciones nuevas.',
  },
];

export function NotificationPrefsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingKey, setSavingKey] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getNotificationPrefs();
      // El backend puede devolver las prefs planas o dentro de `prefs`.
      const p = data.prefs || data;
      setPrefs({
        reminders: p.reminders !== false,
        offers: p.offers !== false,
        messages: p.messages !== false,
        promos: p.promos !== false,
      });
    } catch (e) {
      Alert.alert('No pudimos cargar tus preferencias', e.message || 'Intentá de nuevo.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(key) {
    if (!prefs || savingKey) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSavingKey(key);
    try {
      await api.saveNotificationPrefs(next);
    } catch (e) {
      // Revertir si falló el guardado.
      setPrefs(prefs);
      Alert.alert('No se pudo guardar', e.message || 'Revisá tu conexión e intentá de nuevo.');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Notificaciones" onBack={() => navigation.goBack()} />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
        >
          <Text style={styles.intro}>
            Elegí qué avisos querés recibir. Los avisos esenciales de seguridad de tu cuenta no se
            pueden desactivar.
          </Text>
          {PREFS.map((p) => (
            <Card key={p.key} style={styles.row}>
              <View style={styles.texts}>
                <Text style={styles.title}>{p.title}</Text>
                <Text style={styles.desc}>{p.desc}</Text>
              </View>
              <Switch
                value={!!prefs?.[p.key]}
                onValueChange={() => toggle(p.key)}
                disabled={savingKey !== null}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </Card>
          ))}
          {savingKey && (
            <Text style={styles.saving}>Guardando…</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  intro: { fontSize: fontSize.sm, color: colors.muted, lineHeight: 20, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  texts: { flex: 1, marginRight: spacing.sm },
  title: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  desc: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4, lineHeight: 20 },
  saving: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', marginTop: spacing.sm },
});
