import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Chambas cerca 🗺️: el "mapa" de chambas del modo handyman.
 * Igual que el mapa de profesionales (SearchScreen): como el mapa nativo
 * está declarado pendiente, esto es la lista de tareas ordenada por
 * distancia con el badge "a X km". GET /api/tasks?lat=&lng= trae distance_km
 * por tarea; sin permiso de ubicación se muestra la lista sin distancias.
 */
function distanceBadge(t) {
  const d = Number(t.distance_km);
  if (!Number.isFinite(d)) return null;
  return d < 1 ? 'a menos de 1 km' : `a ${d.toFixed(d < 10 ? 1 : 0)} km`;
}

function priceRange(t) {
  if (t.price_min_gs && t.price_max_gs) return `${gs(t.price_min_gs)} – ${gs(t.price_max_gs)}`;
  if (t.price_max_gs) return `Hasta ${gs(t.price_max_gs)}`;
  if (t.price_min_gs) return `Desde ${gs(t.price_min_gs)}`;
  return 'Precio a convenir';
}

export function ChambasMapScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [tasks, setTasks] = useState([]);
  const [coords, setCoords] = useState(null); // { lat, lng } o null
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [locating, setLocating] = useState(false);

  const load = useCallback(async (overrideCoords) => {
    try {
      const loc = overrideCoords !== undefined ? overrideCoords : coords;
      const { tasks: list } = await api.tasks(
        loc ? { lat: loc.lat, lng: loc.lng } : {}
      );
      // Orden defensivo por distancia: el backend ya ordena, pero si algún
      // día devuelve sin distance_km (sin coords), no reordenamos nada.
      const sorted = [...(list || [])].sort((a, b) => {
        const da = Number(a.distance_km);
        const db = Number(b.distance_km);
        if (!Number.isFinite(da)) return 1;
        if (!Number.isFinite(db)) return -1;
        return da - db;
      });
      setTasks(sorted);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [coords]);

  useEffect(() => {
    load();
  }, [load]);

  // Recargar al volver de otra pantalla (ej. después de publicar una tarea).
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      setRefreshing(true);
      load();
    });
    return unsub;
  }, [navigation, load]);

  /** "Usar mi ubicación": pide permiso; si se deniega, muestra la lista sin
   *  distancias igual que hoy (no bloquea el flujo). */
  async function useMyLocation() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Sin acceso a tu ubicación',
          'No nos diste permiso de ubicación. Podés ver las chambas igual, pero sin la distancia.'
        );
        await load(null);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(next);
      await load(next);
    } catch {
      Alert.alert(
        'No pudimos obtener tu ubicación',
        'Revisá que el GPS esté activado. Mientras tanto te mostramos las chambas sin distancia.'
      );
      await load(null);
    } finally {
      setLocating(false);
    }
  }

  function clearLocation() {
    setCoords(null);
    setRefreshing(true);
    load(null);
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Chambas cerca 🗺️" onBack={() => navigation.goBack()} />
      <View style={[styles.locBar, { paddingBottom: spacing.sm }]}>
        <TouchableOpacity
          style={[styles.locBtn, coords && styles.locBtnActive]}
          onPress={useMyLocation}
          disabled={locating}
          activeOpacity={0.85}
        >
          <Text style={[styles.locBtnText, coords && styles.locBtnTextActive]}>
            {locating
              ? 'Buscando tu ubicación…'
              : coords
                ? '📍 Cerca de mí (activo)'
                : '📍 Usar mi ubicación'}
          </Text>
        </TouchableOpacity>
        {coords && (
          <TouchableOpacity onPress={clearLocation} style={styles.locClear} hitSlop={10}>
            <Text style={styles.locClearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {!coords && !loading && (
        <Text style={styles.noLocHint}>
          Activá tu ubicación para ver las chambas ordenadas por distancia.
        </Text>
      )}

      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : tasks.length === 0 ? (
          <Card>
            <Text style={styles.empty}>
              No hay chambas abiertas por acá. Probá de nuevo en un rato.
            </Text>
          </Card>
        ) : (
          tasks.map((t) => {
            const badge = distanceBadge(t);
            return (
              <Card key={t.id} onPress={() => navigation.navigate('TaskDetail', { taskId: t.id })}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} numberOfLines={2}>{t.title}</Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {t.client_name}{t.barrio ? ` — ${t.barrio}` : ''}
                    </Text>
                  </View>
                  {t.urgent ? (
                    <View style={styles.urgentBadge}>
                      <Text style={styles.urgentText}>⚡ HOY</Text>
                    </View>
                  ) : null}
                </View>
                {t.description ? (
                  <Text style={styles.desc} numberOfLines={2}>{t.description}</Text>
                ) : null}
                <View style={styles.footer}>
                  <Text style={styles.price}>{priceRange(t)}</Text>
                  {badge ? (
                    <View style={styles.distBadge}>
                      <Text style={styles.distText}>📍 {badge}</Text>
                    </View>
                  ) : null}
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  locBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, gap: spacing.sm },
  locBtn: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center',
  },
  locBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  locBtnText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
  locBtnTextActive: { color: '#fff' },
  locClear: {
    backgroundColor: colors.card, borderRadius: 20, borderWidth: 1,
    borderColor: colors.border, width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
  },
  locClearText: { color: colors.muted, fontWeight: '800' },
  noLocHint: {
    fontSize: fontSize.xs, color: colors.muted, textAlign: 'center',
    paddingHorizontal: spacing.md, marginBottom: spacing.xs,
  },
  inner: { padding: spacing.md, paddingTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  meta: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  desc: { fontSize: fontSize.sm, color: colors.text, marginTop: 6, lineHeight: 20 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  price: { fontSize: fontSize.md, fontWeight: '800', color: colors.primary },
  distBadge: { backgroundColor: colors.light, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 },
  distText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.primary },
  urgentBadge: { backgroundColor: colors.urgent, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10, marginLeft: spacing.sm },
  urgentText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '800' },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
});
