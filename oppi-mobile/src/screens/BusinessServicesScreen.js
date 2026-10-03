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
import { api } from '../api/client';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { ServiceEditorModal } from './business/ServiceEditorModal';
import { gs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Servicios del negocio (ruta "BusinessServices", params {businessId}).
 * Toggle activo/pausado y precio editable al tocar (modal con
 * validación en rojo), [+ Agregar servicio], eliminar con confirmación.
 *
 * NOTA backend: la tabla `services` no tiene columna `active`; el toggle
 * es estado local de la app (no persiste al recargar).
 */
export function BusinessServicesScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { businessId } = route.params;
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [localActive, setLocalActive] = useState({});
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { services: list } = await api.services({ business_id: businessId });
      setServices(list || []);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar los servicios.');
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

  const isActive = (s) => localActive[s.id] !== false;

  async function handleSave(payload) {
    setSaving(true);
    try {
      if (editing) {
        await api.updateService(editing.id, payload);
      } else {
        await api.createService({ business_id: Number(businessId), ...payload });
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

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Mis servicios" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : services.length === 0 ? (
          <Card>
            <Text style={styles.empty}>Todavía no cargaste servicios.</Text>
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
                  <Text style={styles.svcSub}>
                    {gs(s.price_gs)}
                  </Text>
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
          title="＋ Agregar servicio"
          variant="ghost"
          onPress={() => {
            setEditing(null);
            setModalVisible(true);
          }}
          style={{ minHeight: 52, borderRadius: 16, marginTop: spacing.md }}
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
  inner: { padding: spacing.md },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
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
