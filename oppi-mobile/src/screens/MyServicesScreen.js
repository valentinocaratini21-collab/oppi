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
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { ServiceEditorModal } from './business/ServiceEditorModal';
import { TaxonomyPicker } from '../components/TaxonomyPicker';
import { gs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * "Mis servicios" del PROFESIONAL (ruta "MyServices").
 * Si no tiene perfil profesional → formulario para crearlo
 * (createProfessional; requiere rol 'pro'). Si ya existe → lista de
 * servicios con toggle activo/pausado (local), edición, [+ Agregar servicio]
 * y eliminar con confirmación. Pago 100%: sin seña.
 *
 * NOTA backend: `services` no tiene columna `active` → el toggle es
 * estado local de la app (no persiste al recargar).
 */
export function MyServicesScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { fromRegistration } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState(null);

  // Form de creación de perfil
  const [bio, setBio] = useState('');
  const [taxonomy, setTaxonomy] = useState({});
  const [barrio, setBarrio] = useState('');
  const [creating, setCreating] = useState(false);

  // Servicios
  const [services, setServices] = useState([]);
  const [localActive, setLocalActive] = useState({});
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { professionals } = await api.professionals();
      const mine = (professionals || []).find((p) => p.user_id === user?.id) || null;
      setProfile(mine);
      if (mine) {
        const { services: list } = await api.services({ professional_id: mine.id });
        setServices(list || []);
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar tus servicios.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  async function createProfile() {
    setCreating(true);
    try {
      const rubro = taxonomy.professionName || taxonomy.categoryName || '';
      const { professional } = await api.createProfessional({
        bio: bio.trim(),
        categories: rubro ? [rubro] : [],
        barrio: barrio.trim(),
      });
      setProfile(professional);
    } catch (e) {
      Alert.alert('No pudimos crear tu perfil', e.message || 'Intentá de nuevo.');
    } finally {
      setCreating(false);
    }
  }

  const isActive = (s) => localActive[s.id] !== false;

  async function handleSave(payload) {
    setSaving(true);
    try {
      if (editing) {
        await api.updateService(editing.id, payload);
      } else {
        await api.createService({ professional_id: profile.id, ...payload });
      }
      setModalVisible(false);
      setEditing(null);
      await load();
    } catch (e) {
      Alert.alert('No se pudo guardar', e.message || 'Revisá los datos e intentá de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(s) {
    Alert.alert(
      'Eliminar servicio',
      `¿Eliminar "${s.name}"? Deja de ofrecerse y no se puede deshacer.`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Sí, eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteService(s.id);
              await load();
            } catch (e) {
              Alert.alert('Error', e.message || 'No se pudo eliminar.');
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (user?.role !== 'pro') {
    return (
      <View style={styles.wrap}>
        <ScreenHeader
          title="Mis servicios"
          // Recién registrado: detrás no hay nada → el atrás va a las tabs.
          onBack={() => (fromRegistration ? navigation.replace('MainTabs') : navigation.goBack())}
        />
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Esta sección es para profesionales</Text>
          <Text style={styles.emptySub}>
            Tu cuenta es de tipo "{user?.role}". Creá una cuenta de profesional para ofrecer servicios.
          </Text>
        </View>
      </View>
    );
  }

  // Sin perfil → crearlo.
  if (!profile) {
    return (
      <KeyboardAvoidingView
        style={styles.wrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScreenHeader
          title="Mis servicios"
          // Recién registrado: detrás no hay nada → el atrás va a las tabs.
          onBack={() => (fromRegistration ? navigation.replace('MainTabs') : navigation.goBack())}
        />
        <ScrollView
          contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.h1}>Completá tu perfil profesional</Text>
          <Text style={styles.sub}>
            Contanos a qué te dedicás para que los clientes te encuentren.
          </Text>

          <Text style={styles.label}>¿A qué te dedicás? (bio)</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={bio}
            onChangeText={setBio}
            placeholder="Ej: Peluquera con 8 años de experiencia, especialista en color."
            placeholderTextColor={colors.muted}
            multiline
          />

          <TaxonomyPicker
            label="¿A qué te dedicás?"
            value={taxonomy}
            onChange={setTaxonomy}
          />

          <Text style={styles.label}>Barrio / zona</Text>
          <TextInput
            style={styles.input}
            value={barrio}
            onChangeText={setBarrio}
            placeholder="Ej: Villa Morra"
            placeholderTextColor={colors.muted}
          />

          <PrimaryButton
            title="Crear mi perfil"
            onPress={createProfile}
            loading={creating}
            style={{ minHeight: 52, borderRadius: 16, marginTop: spacing.lg }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader
          title="Mis servicios"
          // Recién registrado: detrás no hay nada → el atrás va a las tabs.
          onBack={() => (fromRegistration ? navigation.replace('MainTabs') : navigation.goBack())}
        />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {services.length === 0 ? (
          <Card>
            <Text style={styles.empty}>Todavía no cargaste servicios. Agregá el primero 👇</Text>
          </Card>
        ) : (
          services.map((s) => (
            <Card key={s.id} style={!isActive(s) && styles.paused}>
              <View style={styles.rowBetween}>
                <TouchableOpacity
                  style={{ flex: 1 }}
                  onPress={() => {
                    setEditing(s);
                    setModalVisible(true);
                  }}
                >
                  <Text style={styles.svcName}>{s.name}</Text>
                  <Text style={styles.svcSub}>{gs(s.price_gs)}</Text>
                  <Text style={styles.editHint}>Tocar para editar ✏️</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggle, isActive(s) ? styles.toggleOn : styles.toggleOff]}
                  onPress={() => setLocalActive((prev) => ({ ...prev, [s.id]: !isActive(s) }))}
                >
                  <Text style={[styles.toggleText, isActive(s) && styles.toggleTextOn]}>
                    {isActive(s) ? 'Activo' : 'Pausado'}
                  </Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => confirmDelete(s)} hitSlop={12}>
                <Text style={styles.delete}>Eliminar</Text>
              </TouchableOpacity>
            </Card>
          ))
        )}

        <PrimaryButton
          title="💰 Ganancias"
          variant="secondary"
          onPress={() => navigation.navigate('ProEarnings')}
          style={{ minHeight: 52, borderRadius: 16, marginTop: spacing.md }}
        />
        <PrimaryButton
          title="👥 Mis clientes"
          variant="secondary"
          onPress={() => navigation.navigate('ProClients')}
          style={{ minHeight: 52, borderRadius: 16, marginTop: spacing.sm }}
        />
        <PrimaryButton
          title="📊 Estadísticas"
          variant="secondary"
          onPress={() => navigation.navigate('ProStats')}
          style={{ minHeight: 52, borderRadius: 16, marginTop: spacing.sm }}
        />
        <PrimaryButton
          title="＋ Agregar servicio"
          variant="ghost"
          onPress={() => {
            setEditing(null);
            setModalVisible(true);
          }}
          style={{ minHeight: 52, borderRadius: 16, marginTop: spacing.sm }}
        />
        <Text style={styles.note}>
          El interruptor activo/pausado es solo de esta app: el servidor todavía no lo guarda.
        </Text>
      </ScrollView>

      <ServiceEditorModal
        visible={modalVisible}
        title={editing ? 'Editar servicio' : 'Nuevo servicio'}
        initial={editing}
        saving={saving}
        onClose={() => {
          setModalVisible(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  inner: { padding: spacing.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: 12 },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptySub: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  h1: { fontSize: fontSize.xl, fontWeight: '900', color: colors.text },
  sub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4, marginBottom: spacing.sm },
  label: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, fontSize: fontSize.md, color: colors.text,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  paused: { opacity: 0.6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  svcName: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  svcSub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  editHint: { fontSize: fontSize.xs, color: colors.primary, marginTop: 4 },
  toggle: {
    borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1,
  },
  toggleOn: { backgroundColor: '#E6F7ED', borderColor: colors.success },
  toggleOff: { backgroundColor: colors.bg, borderColor: colors.border },
  toggleText: { fontSize: fontSize.xs, fontWeight: '800', color: colors.muted },
  toggleTextOn: { color: colors.success },
  delete: { color: colors.danger, fontSize: fontSize.sm, fontWeight: '600', marginTop: spacing.sm },
  note: { fontSize: fontSize.xs, color: colors.muted, textAlign: 'center', marginTop: spacing.md, lineHeight: 18 },
});
