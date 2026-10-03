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
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors, fontSize, spacing, radius } from '../theme';

const EMPTY_FORM = { nombre: '', direccion: '', telefono: '', horario: '', lat: '', lng: '' };

/**
 * "Sucursales" del negocio (ruta "BusinessBranches", params {businessId}).
 * Lista, agrega, edita y elimina (con confirmación) las sucursales:
 * GET/POST/PATCH/DELETE /api/businesses/:id/branches.
 */
export function BusinessBranchesScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { businessId } = route.params || {};
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modal de alta/edición
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.businessBranches(businessId);
      setBranches(data.branches || data || []);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar las sucursales.');
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

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError('');
    setModalVisible(true);
  }

  function openEdit(b) {
    setEditing(b);
    setForm({
      nombre: b.nombre || '',
      direccion: b.direccion || '',
      telefono: b.telefono || '',
      horario: b.horario || '',
      lat: b.lat != null ? String(b.lat) : '',
      lng: b.lng != null ? String(b.lng) : '',
    });
    setError('');
    setModalVisible(true);
  }

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    if (!form.nombre.trim()) {
      setError('Poné el nombre de la sucursal.');
      return;
    }
    const payload = {
      nombre: form.nombre.trim(),
      direccion: form.direccion.trim(),
      telefono: form.telefono.trim(),
      horario: form.horario.trim(),
      ...(form.lat.trim() ? { lat: Number(form.lat) } : {}),
      ...(form.lng.trim() ? { lng: Number(form.lng) } : {}),
    };
    setSaving(true);
    try {
      if (editing) {
        await api.updateBranch(businessId, editing.id, payload);
      } else {
        await api.createBranch(businessId, payload);
      }
      setModalVisible(false);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e.message || 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(b) {
    Alert.alert(
      'Eliminar sucursal',
      `¿Eliminar "${b.nombre}"? No se puede deshacer.`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Sí, eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteBranch(businessId, b.id);
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
      <ScreenHeader title="Sucursales" onBack={() => navigation.goBack()} />
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.muted}>Cargando sucursales…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
          }
        >
          {branches.length === 0 ? (
            <Card>
              <Text style={styles.emptyTitle}>Todavía no cargaste sucursales 🏪</Text>
              <Text style={styles.emptySub}>
                Si tu negocio tiene más de un local, cargalos acá: los clientes
                eligen en cuál reservar.
              </Text>
            </Card>
          ) : (
            branches.map((b) => (
              <Card key={b.id}>
                <Text style={styles.name}>{b.nombre}</Text>
                {!!b.direccion && <Text style={styles.meta}>📍 {b.direccion}</Text>}
                {!!b.horario && <Text style={styles.meta}>🕘 {b.horario}</Text>}
                {!!b.telefono && <Text style={styles.meta}>📞 {b.telefono}</Text>}
                <View style={styles.actions}>
                  <TouchableOpacity onPress={() => openEdit(b)} hitSlop={8}>
                    <Text style={styles.edit}>Editar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => confirmDelete(b)} hitSlop={8}>
                    <Text style={styles.delete}>Eliminar</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            ))
          )}

          <PrimaryButton
            title="＋ Agregar sucursal"
            onPress={openNew}
            style={{ minHeight: 52, borderRadius: 16, marginTop: spacing.md }}
          />
        </ScrollView>
      )}

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.backdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
          >
            <View style={styles.head}>
              <Text style={styles.title}>{editing ? 'Editar sucursal' : 'Nueva sucursal'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={12} style={styles.close}>
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Nombre *</Text>
              <TextInput
                style={styles.input}
                value={form.nombre}
                onChangeText={(t) => set('nombre', t)}
                placeholder="Ej: Sucursal Villa Morra"
                placeholderTextColor={colors.muted}
              />
              <Text style={styles.label}>Dirección</Text>
              <TextInput
                style={styles.input}
                value={form.direccion}
                onChangeText={(t) => set('direccion', t)}
                placeholder="Ej: Av. Mariscal López 2024"
                placeholderTextColor={colors.muted}
              />
              <Text style={styles.label}>Teléfono</Text>
              <TextInput
                style={styles.input}
                value={form.telefono}
                onChangeText={(t) => set('telefono', t)}
                placeholder="0981 000 000"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
              />
              <Text style={styles.label}>Horario</Text>
              <TextInput
                style={styles.input}
                value={form.horario}
                onChangeText={(t) => set('horario', t)}
                placeholder="Ej: Lun a Vie 9 a 18"
                placeholderTextColor={colors.muted}
              />
              <Text style={styles.label}>Ubicación (opcional)</Text>
              <View style={styles.coordsRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={form.lat}
                  onChangeText={(t) => set('lat', t.replace(/[^0-9.\-]/g, ''))}
                  placeholder="Lat."
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={form.lng}
                  onChangeText={(t) => set('lng', t.replace(/[^0-9.\-]/g, ''))}
                  placeholder="Lng."
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                />
              </View>

              {!!error && <Text style={styles.error}>⚠ {error}</Text>}

              <PrimaryButton
                title={editing ? 'Guardar cambios' : 'Agregar'}
                onPress={save}
                loading={saving}
                style={{ minHeight: 52, borderRadius: 16, marginTop: spacing.md }}
              />
              <PrimaryButton title="Cancelar" variant="ghost" onPress={() => setModalVisible(false)} />
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: colors.muted },
  inner: { padding: spacing.md },
  name: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  meta: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  actions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  edit: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '700' },
  delete: { color: colors.danger, fontSize: fontSize.sm, fontWeight: '700' },
  emptyTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptySub: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 20 },
  backdrop: { flex: 1, backgroundColor: 'rgba(26,26,46,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, maxHeight: '92%',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  close: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  closeText: { fontSize: fontSize.md, color: colors.text, fontWeight: '700' },
  label: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, fontSize: fontSize.md, color: colors.text,
  },
  coordsRow: { flexDirection: 'row', gap: spacing.sm },
  error: {
    fontSize: fontSize.sm, color: colors.danger, fontWeight: '700',
    backgroundColor: '#FDECEC', borderRadius: radius.button, padding: 10, marginTop: spacing.md,
  },
});
