import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs, label } from '../utils';
import { FEATURE_MAP } from '../config';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Modo handyman: stats del mes, toggle de disponibilidad para urgencias,
 * alertas por rubro y lista de trabajos → JobDetail.
 *
 * ⚠️ El backend NO tiene campo para "disponible para urgencias" ni para las
 * alertas por rubro: ambos se guardan en local (AsyncStorage) por ahora.
 * Cuando el backend lo soporte, mover a PATCH /api/me o similar.
 */
const AVAIL_KEY = 'oppi.handyman.available_urgent';
const ALERTS_KEY = 'oppi.handyman.alert_rubros';

// Rubros de tareas (los mismos que la web: oppi-web/js/data.js → taskCategories).
export const TASK_RUBROS = [
  { id: 'plomeria', name: 'Plomería', icon: '🔧' },
  { id: 'electricidad', name: 'Electricidad', icon: '💡' },
  { id: 'pintura', name: 'Pintura', icon: '🎨' },
  { id: 'limpieza', name: 'Limpieza', icon: '🧹' },
  { id: 'mudanza', name: 'Mudanza', icon: '📦' },
  { id: 'jardin', name: 'Jardín', icon: '🌿' },
  { id: 'otros', name: 'Otros', icon: '🛠️' },
];

function currentMonthKey(dateStr) {
  try {
    const d = new Date(dateStr.replace(' ', 'T'));
    return `${d.getFullYear()}-${d.getMonth()}`;
  } catch {
    return '';
  }
}

export function HandymanHomeScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { fromRegistration } = route.params || {};
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [available, setAvailable] = useState(true);
  const [alertRubros, setAlertRubros] = useState([]);

  const load = useCallback(async () => {
    try {
      const { jobs: list } = await api.jobs();
      const mine = (list || []).filter((j) => j.handyman_id === user?.id);
      setJobs(mine);
      // Preferencias locales (no hay campo en el backend todavía).
      const [av, al] = await Promise.all([
        AsyncStorage.getItem(AVAIL_KEY),
        AsyncStorage.getItem(ALERTS_KEY),
      ]);
      if (av !== null) setAvailable(av === '1');
      try {
        setAlertRubros(al ? JSON.parse(al) : []);
      } catch {
        setAlertRubros([]);
      }
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      setRefreshing(true);
      load();
    });
    return unsub;
  }, [navigation, load]);

  const nowKey = `${new Date().getFullYear()}-${new Date().getMonth()}`;
  const active = jobs.filter((j) => j.status !== 'completed');
  const done = jobs.filter((j) => j.status === 'completed');
  const earnedMonth = done
    .filter((j) => currentMonthKey(j.created_at) === nowKey)
    .reduce((a, j) => a + (Number(j.agreed_price_gs) || 0), 0);

  async function toggleAvailable(next) {
    setAvailable(next);
    try {
      await AsyncStorage.setItem(AVAIL_KEY, next ? '1' : '0');
    } catch {
      // local-only, no bloquea
    }
  }

  async function toggleRubro(id) {
    const next = alertRubros.includes(id)
      ? alertRubros.filter((r) => r !== id)
      : [...alertRubros, id];
    setAlertRubros(next);
    try {
      await AsyncStorage.setItem(ALERTS_KEY, JSON.stringify(next));
    } catch {
      // local-only, no bloquea
    }
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader
        title="Modo handyman 🔨"
        // Recién registrado: detrás no hay nada → el atrás va a las tabs.
        onBack={() => (fromRegistration ? navigation.replace('MainTabs') : navigation.goBack())}
      />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {/* Stats */}
        <View style={styles.statsRow}>
          <Card style={styles.stat}>
            <Text style={styles.statValue}>{gs(earnedMonth)}</Text>
            <Text style={styles.statLabel}>Ganado este mes</Text>
          </Card>
          <Card style={styles.stat}>
            <Text style={styles.statValue}>{active.length}</Text>
            <Text style={styles.statLabel}>Activos</Text>
          </Card>
          <Card style={styles.stat}>
            <Text style={styles.statValue}>{done.length}</Text>
            <Text style={styles.statLabel}>Completados</Text>
          </Card>
        </View>

        {/* Chambas cerca: lista ordenada por distancia (el "mapa" handyman).
            Con FEATURE_MAP en false se oculta el botón (el mapa está en pausa,
            pero el archivo ChambasMapScreen se conserva). */}
        {FEATURE_MAP && (
          <PrimaryButton
            title="Ver mapa 🗺️"
            onPress={() => navigation.navigate('ChambasMap')}
            style={{ marginTop: spacing.md }}
          />
        )}

        {/* Disponibilidad para urgencias */}
        <Card style={{ marginTop: spacing.md }}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleTitle}>⚡ Disponible para urgencias</Text>
              <Text style={styles.toggleSub}>Te avisamos primero de las tareas urgentes cerca tuyo.</Text>
            </View>
            <Switch
              value={available}
              onValueChange={toggleAvailable}
              trackColor={{ false: colors.border, true: colors.primary }}
            />
          </View>
        </Card>

        {/* Alertas por rubro */}
        <Text style={styles.section}>Alertas por rubro</Text>
        <View style={styles.chips}>
          {TASK_RUBROS.map((r) => {
            const on = alertRubros.includes(r.id);
            return (
              <TouchableOpacity
                key={r.id}
                style={[styles.chip, on && styles.chipActive]}
                onPress={() => toggleRubro(r.id)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, on && styles.chipTextActive]}>
                  {r.icon} {r.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Mis trabajos */}
        <Text style={styles.section}>Mis trabajos</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />
        ) : jobs.length === 0 ? (
          <Card>
            <Text style={styles.emptyTitle}>Todavía no tenés trabajos 🛠️</Text>
            <Text style={styles.emptyBody}>
              Explorá las tareas abiertas y hacé tu primera oferta. Cuando un cliente la acepte, el trabajo aparece acá.
            </Text>
            <PrimaryButton
              title="Explorar chambas"
              onPress={() => navigation.navigate('MainTabs', { screen: 'Explorar' })}
              style={{ marginTop: spacing.md }}
            />
          </Card>
        ) : (
          jobs.map((j) => (
            <Card key={j.id} onPress={() => navigation.navigate('JobDetail', { jobId: j.id })}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.jobTitle} numberOfLines={2}>{j.task_title}</Text>
                  <Text style={styles.jobMeta}>
                    {j.client_name ? `${j.client_name} · ` : ''}{gs(j.agreed_price_gs)}
                  </Text>
                </View>
                <View style={[styles.statusBadge, j.status === 'completed' && styles.statusBadgeDone]}>
                  <Text style={[styles.statusText, j.status === 'completed' && styles.statusTextDone]}>
                    {label(j.status)}
                  </Text>
                </View>
              </View>
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  statsRow: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: fontSize.lg, fontWeight: '800', color: colors.primary },
  statLabel: { fontSize: fontSize.xs, color: colors.muted, marginTop: 4, textAlign: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  toggleTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  toggleSub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  section: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 8, paddingHorizontal: 12,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  jobTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  jobMeta: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  statusBadge: { backgroundColor: colors.light, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10, marginLeft: spacing.sm },
  statusBadgeDone: { backgroundColor: '#E6F6EC' },
  statusText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  statusTextDone: { color: colors.success },
  emptyTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptyBody: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 20 },
});
