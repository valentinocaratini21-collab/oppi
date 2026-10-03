import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { Rating } from '../components/Rating';
import { ScreenHeader } from '../components/ScreenHeader';
import { SearchFiltersModal, FILTER_DEFAULTS } from '../components/SearchFiltersModal';
import { TASK_RUBROS } from './HandymanHomeScreen';
import { gs } from '../utils';
import { FEATURE_MAP } from '../config';
import { colors, fontSize, spacing, radius } from '../theme';

/** Búsqueda con dos modos: profesionales (filtros: texto, categoría, barrio)
 *  y Chamba (explorar tareas: filtros por rubro y barrio, urgentes primero).
 *
 *  Cercanía: botón "📍 Cerca de mí" (expo-location). Si el usuario acepta,
 *  pasamos {lat, lng, radio_km} a GET /api/search y cada resultado trae
 *  `distance_km` (ordenado asc). Si se deniega el permiso, mensaje claro y
 *  se sigue buscando sin ubicación.
 *  El mapa nativo queda declarado como pendiente en el README: acá no se
 *  simula ningún mapa, solo se muestra la distancia en texto. */
const CATEGORY_OPTIONS = [
  '', 'peluquería', 'barbería', 'electricidad', 'plomería', 'limpieza',
  'manicura', 'maquillaje', 'masajes', 'climatización',
];
const RADIUS_OPTIONS = [5, 10, 25];

function distanceBadge(p) {
  const d = Number(p.distance_km);
  if (!Number.isFinite(d)) return null;
  return d < 1 ? 'a menos de 1 km' : `a ${d.toFixed(d < 10 ? 1 : 0)} km`;
}

function priceRange(t) {
  if (t.price_min_gs && t.price_max_gs) return `${gs(t.price_min_gs)} – ${gs(t.price_max_gs)}`;
  if (t.price_max_gs) return `Hasta ${gs(t.price_max_gs)}`;
  if (t.price_min_gs) return `Desde ${gs(t.price_min_gs)}`;
  return 'Precio a convenir';
}

export function SearchScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState(route.params?.q || '');
  const [category, setCategory] = useState(route.params?.category || '');
  const [rubro, setRubro] = useState('');
  const [barrio, setBarrio] = useState('');
  const [pros, setPros] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [mode, setMode] = useState('pro'); // 'pro' | 'chamba'

  // Cercanía: coordenadas { lat, lng } o null. radioKm: radio de búsqueda.
  const [coords, setCoords] = useState(null);
  const [radioKm, setRadioKm] = useState(10);
  const [locating, setLocating] = useState(false);

  // Filtros avanzados (precio en Gs., disponibilidad, orden).
  const [filters, setFilters] = useState(FILTER_DEFAULTS);
  const [filtersVisible, setFiltersVisible] = useState(false);

  function filtersActive(f = filters) {
    return !!(f.minPrice || f.maxPrice || f.disponibilidad || (f.orden && f.orden !== 'relevancia'));
  }

  const search = useCallback(
    async (override = {}) => {
      setLoading(true);
      try {
        const loc = override.coords !== undefined ? override.coords : coords;
        const rad = override.radioKm ?? radioKm;
        const f = override.filters ?? filters;
        if (loc || filtersActive(f)) {
          // Con ubicación o con filtros activos: GET /api/search
          // {q, rubro, lat, lng, radio_km, min_price, max_price,
          //  disponibilidad, orden} trae distance_km ordenado ascendente.
          const data = await api.search({
            q: override.q ?? q,
            rubro: override.category ?? category,
            lat: loc?.lat,
            lng: loc?.lng,
            radio_km: rad,
            min_price: f.minPrice,
            max_price: f.maxPrice,
            disponibilidad: f.disponibilidad,
            orden: f.orden,
          });
          setPros(data.results || data.professionals || []);
        } else {
          const { professionals } = await api.professionals({
            q: override.q ?? q,
            category: override.category ?? category,
            barrio,
          });
          setPros(professionals);
        }
        setSearched(true);
      } catch {
        setPros([]);
        setSearched(true);
      } finally {
        setLoading(false);
      }
    },
    [q, category, barrio, coords, radioKm, filters]
  );

  // Chamba: explorar tareas. El backend ordena urgent DESC, así que las
  // urgentes ya llegan primero; la UI lo refleja con el badge ⚡ Urgente.
  const searchTasks = useCallback(
    async (override = {}) => {
      setLoading(true);
      try {
        const { tasks: list } = await api.tasks({
          category: override.rubro ?? rubro,
          barrio: barrio.trim(),
        });
        setTasks(list || []);
        setSearched(true);
      } catch {
        setTasks([]);
        setSearched(true);
      } finally {
        setLoading(false);
      }
    },
    [rubro, barrio]
  );

  useEffect(() => {
    if (mode === 'chamba') searchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    // Si llegamos desde Home con categoría o texto, buscamos directo.
    // También reacciona si cambian los params mientras la tab ya está montada.
    const initial = route.params;
    if (initial?.category || initial?.q) {
      if (initial.category) setCategory(initial.category);
      if (initial.q) setQ(initial.q);
      search({ category: initial.category || '', q: initial.q || '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.q, route.params?.category]);

  /** "Cerca de mí": pide permiso de ubicación; si se deniega, mensaje claro
   *  y se sigue buscando sin ubicación (sin bloquear el flujo). */
  async function useMyLocation() {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Sin acceso a tu ubicación',
          'No nos diste permiso de ubicación. Podés seguir buscando por barrio o categoría igual.'
        );
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCoords(next);
      await search({ coords: next });
    } catch {
      Alert.alert(
        'No pudimos obtener tu ubicación',
        'Revisá que el GPS esté activado. Mientras tanto podés buscar por barrio.'
      );
    } finally {
      setLocating(false);
    }
  }

  function clearLocation() {
    setCoords(null);
    search({ coords: null });
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Buscar" />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Selector de modo: profesionales vs chamba (tareas) */}
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modePill, mode === 'pro' && styles.modePillActive]}
            onPress={() => setMode('pro')}
            activeOpacity={0.85}
          >
            <Text style={[styles.modeText, mode === 'pro' && styles.modeTextActive]}>👥 Profesionales</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modePill, mode === 'chamba' && styles.modePillActive]}
            onPress={() => setMode('chamba')}
            activeOpacity={0.85}
          >
            <Text style={[styles.modeText, mode === 'chamba' && styles.modeTextActive]}>🔨 Chamba</Text>
          </TouchableOpacity>
        </View>

        {mode === 'pro' ? (
          <>
            {/* Cercanía (en pausa con FEATURE_MAP en false: el mapa está en
                pausa pero el código se conserva intacto). */}
            {FEATURE_MAP && (
              <View style={styles.locRow}>
                <TouchableOpacity
                  style={[styles.locBtn, coords && styles.locBtnActive]}
                  onPress={useMyLocation}
                  disabled={locating}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.locBtnText, coords && styles.locBtnTextActive]}>
                    {locating ? 'Buscando tu ubicación…' : coords ? '📍 Cerca de mí (activo)' : '📍 Cerca de mí'}
                  </Text>
                </TouchableOpacity>
                {coords && (
                  <TouchableOpacity onPress={clearLocation} style={styles.locClear} hitSlop={10}>
                    <Text style={styles.locClearText}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {coords && (
              <>
                <Text style={styles.label}>Radio</Text>
                <View style={styles.chips}>
                  {RADIUS_OPTIONS.map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.chip, radioKm === r && styles.chipActive]}
                      onPress={() => {
                        setRadioKm(r);
                        search({ radioKm: r });
                      }}
                    >
                      <Text style={[styles.chipText, radioKm === r && styles.chipTextActive]}>
                        {r} km
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <TextInput
              style={styles.input}
              placeholder="Nombre o palabra clave…"
              placeholderTextColor={colors.muted}
              value={q}
              onChangeText={setQ}
              onSubmitEditing={() => search()}
              returnKeyType="search"
            />
            <TextInput
              style={styles.input}
              placeholder="Barrio (ej. Villa Morra)"
              placeholderTextColor={colors.muted}
              value={barrio}
              onChangeText={setBarrio}
              onSubmitEditing={() => search()}
              returnKeyType="search"
            />

            <Text style={styles.label}>Categoría</Text>
            <View style={styles.chips}>
              {CATEGORY_OPTIONS.map((c) => (
                <TouchableOpacity
                  key={c || 'all'}
                  style={[styles.chip, category === c && styles.chipActive]}
                  onPress={() => {
                    setCategory(c);
                    search({ category: c });
                  }}
                >
                  <Text style={[styles.chipText, category === c && styles.chipTextActive]}>
                    {c === '' ? 'Todas' : c}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.searchBtn} onPress={() => search()}>
              <Text style={styles.searchBtnText}>Buscar</Text>
            </TouchableOpacity>

            <View style={styles.filterRow}>
              <TouchableOpacity
                style={[styles.filterBtn, filtersActive() && styles.filterBtnActive]}
                onPress={() => setFiltersVisible(true)}
                activeOpacity={0.85}
              >
                <Text style={[styles.filterBtnText, filtersActive() && styles.filterBtnTextActive]}>
                  🎛️ Filtros{filtersActive() ? ' •' : ''}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.filterBtn}
                onPress={() => navigation.navigate('Categories')}
                activeOpacity={0.85}
              >
                <Text style={styles.filterBtnText}>📂 Categorías</Text>
              </TouchableOpacity>
            </View>

            <SearchFiltersModal
              visible={filtersVisible}
              initial={filters}
              onClose={() => setFiltersVisible(false)}
              onApply={(f) => {
                setFilters(f);
                setFiltersVisible(false);
                search({ filters: f });
              }}
            />

            {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />}

            {!loading && searched && pros.length === 0 && (
              <Card>
                <Text style={styles.empty}>No encontramos profesionales con esos filtros. Probá con otro barrio o categoría.</Text>
              </Card>
            )}

            {pros.map((p) => (
              <Card key={p.id} onPress={() => navigation.navigate('ProDetail', { proId: p.id })}>
                <View style={styles.proRow}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{(p.name || '?').charAt(0)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.proName}>
                      {p.name} {p.verified ? <Text style={styles.verified}>✓</Text> : null}
                    </Text>
                    <Text style={styles.proMeta} numberOfLines={1}>
                      {(p.categories || []).join(' · ')}{p.barrio ? ` — ${p.barrio}` : ''}
                    </Text>
                    <Rating value={p.rating} />
                  </View>
                  <View style={styles.proRight}>
                    {distanceBadge(p) && (
                      <View style={styles.distBadge}>
                        <Text style={styles.distText}>📍 {distanceBadge(p)}</Text>
                      </View>
                    )}
                    <Text style={styles.chevron}>›</Text>
                  </View>
                </View>
              </Card>
            ))}
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="Barrio (ej. Villa Morra)"
              placeholderTextColor={colors.muted}
              value={barrio}
              onChangeText={setBarrio}
              onSubmitEditing={() => searchTasks()}
              returnKeyType="search"
            />

            <Text style={styles.label}>Rubro</Text>
            <View style={styles.chips}>
              <TouchableOpacity
                style={[styles.chip, rubro === '' && styles.chipActive]}
                onPress={() => {
                  setRubro('');
                  searchTasks({ rubro: '' });
                }}
              >
                <Text style={[styles.chipText, rubro === '' && styles.chipTextActive]}>Todos</Text>
              </TouchableOpacity>
              {TASK_RUBROS.map((r) => (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.chip, rubro === r.name && styles.chipActive]}
                  onPress={() => {
                    setRubro(r.name);
                    searchTasks({ rubro: r.name });
                  }}
                >
                  <Text style={[styles.chipText, rubro === r.name && styles.chipTextActive]}>
                    {r.icon} {r.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.searchBtn} onPress={() => searchTasks()}>
              <Text style={styles.searchBtnText}>Buscar chambas</Text>
            </TouchableOpacity>

            {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />}

            {!loading && searched && tasks.length === 0 && (
              <Card>
                <Text style={styles.empty}>No hay chambas con esos filtros por ahora. Probá con otro rubro o barrio.</Text>
              </Card>
            )}

            {tasks.map((t) => (
              <Card key={t.id} onPress={() => navigation.navigate('TaskDetail', { taskId: t.id })}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.taskTitle} numberOfLines={2}>{t.title}</Text>
                    <Text style={styles.taskMeta} numberOfLines={1}>
                      {t.client_name}{t.barrio ? ` — ${t.barrio}` : ''}{t.category ? ` · ${t.category}` : ''}
                    </Text>
                  </View>
                  {t.urgent ? (
                    <View style={styles.urgentBadge}>
                      <Text style={styles.urgentText}>⚡ Urgente</Text>
                    </View>
                  ) : null}
                </View>
                {t.description ? <Text style={styles.taskDesc} numberOfLines={2}>{t.description}</Text> : null}
                <Text style={styles.taskPrice}>{priceRange(t)}</Text>
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
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    fontSize: fontSize.md,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  label: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  chip: {
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#fff' },
  searchBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.button,
    padding: 14,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  searchBtnText: { color: '#fff', fontWeight: '800', fontSize: fontSize.md },
  filterRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  filterBtn: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.button,
    borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: 'center',
  },
  filterBtnActive: { borderColor: colors.primary, backgroundColor: colors.light },
  filterBtnText: { color: colors.text, fontWeight: '700', fontSize: fontSize.sm },
  filterBtnTextActive: { color: colors.primary },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.sm },
  locBtn: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, paddingVertical: 12, alignItems: 'center',
  },
  locBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  locBtnText: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  locBtnTextActive: { color: '#fff' },
  locClear: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  locClearText: { fontSize: fontSize.md, color: colors.muted },
  proRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 6 },
  distBadge: {
    backgroundColor: colors.light, borderRadius: radius.pill,
    paddingVertical: 4, paddingHorizontal: 10,
  },
  distText: { color: colors.primary, fontSize: fontSize.xs, fontWeight: '800' },
  proRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  avatarText: { fontSize: fontSize.lg, fontWeight: '800', color: colors.primary },
  proName: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  verified: { color: colors.success, fontSize: fontSize.sm },
  proMeta: { fontSize: fontSize.sm, color: colors.muted, marginVertical: 2 },
  chevron: { fontSize: 22, color: colors.muted, marginLeft: spacing.sm },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
  modeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  modePill: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, paddingVertical: 12, alignItems: 'center',
  },
  modePillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeText: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  modeTextActive: { color: '#fff' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  taskTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  taskMeta: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  taskDesc: { fontSize: fontSize.sm, color: colors.text, marginTop: 6, lineHeight: 20 },
  taskPrice: { fontSize: fontSize.md, fontWeight: '800', color: colors.primary, marginTop: 8 },
  urgentBadge: { backgroundColor: colors.urgent, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10, marginLeft: spacing.sm },
  urgentText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '800' },
});
