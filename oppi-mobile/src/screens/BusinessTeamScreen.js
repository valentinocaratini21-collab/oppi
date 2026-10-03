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
  Modal,
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
import { colors, fontSize, spacing, radius } from '../theme';

const AVATAR_COLORS = ['#6B5BD0', '#E8833A', '#1F9D55', '#2D9CDB', '#E5484D', '#9B51E0'];

/**
 * Roles de acceso del equipo (contrato del backend: admin | editor | lectura).
 */
const TEAM_ROLES = [
  {
    value: 'admin',
    label: 'Administrador',
    desc: 'Control total: puede agregar integrantes, quitarlos y cambiar sus roles.',
  },
  {
    value: 'editor',
    label: 'Editor',
    desc: 'Puede agregar y editar integrantes, pero no quitarlos ni dar rol de administrador.',
  },
  {
    value: 'lectura',
    label: 'Lectura',
    desc: 'Solo ve la lista del equipo, sin poder hacer cambios.',
  },
];

function roleLabel(role) {
  const found = TEAM_ROLES.find((r) => r.value === role);
  return found ? found.label : role || '';
}

/**
 * Detecta el rol del usuario actual dentro del equipo:
 *  1) si es el dueño del negocio → admin;
 *  2) si aparece como integrante (por user_id o email) → su rol;
 *  3) por defecto → lectura (no puede gestionar).
 */
function detectMyRole(user, business, team) {
  if (!user) return 'lectura';
  if (business?.user_id && Number(business.user_id) === Number(user.id)) return 'admin';
  const mine = (team || []).find(
    (m) =>
      (m.user_id && Number(m.user_id) === Number(user.id)) ||
      (m.email && user.email && String(m.email).toLowerCase() === String(user.email).toLowerCase())
  );
  if (mine && TEAM_ROLES.some((r) => r.value === mine.role)) return mine.role;
  return 'lectura';
}

/**
 * Equipo del negocio (ruta "BusinessTeam", params {businessId}).
 * CRUD con addTeamMember/updateTeamMember/removeTeamMember.
 * El equipo se lee del detalle del negocio (api.business trae `team`).
 * Al agregar/editar un integrante se elige su rol de acceso
 * (admin | editor | lectura); lo que cada uno puede hacer depende del rol
 * del usuario actual: el lector solo ve, el editor agrega y edita, y solo
 * el admin quita integrantes o asigna el rol de administrador.
 */
function initials(name) {
  return (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

function avatarColor(name) {
  let h = 0;
  for (const c of name || '') h = (h * 31 + c.charCodeAt(0)) % 997;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function BusinessTeamScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { businessId } = route.params;
  const [team, setTeam] = useState([]);
  const [myRole, setMyRole] = useState('lectura');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('editor');
  const [saving, setSaving] = useState(false);

  const canAdd = myRole === 'admin' || myRole === 'editor';
  const canEdit = canAdd;
  const canDelete = myRole === 'admin';
  // Solo el admin puede otorgar el rol de administrador.
  const allowedRoles = myRole === 'admin' ? TEAM_ROLES : TEAM_ROLES.filter((r) => r.value !== 'admin');

  const load = useCallback(async () => {
    try {
      const data = await api.business(businessId);
      const t = data.team || [];
      setTeam(t);
      setMyRole(detectMyRole(user, data.business, t));
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar tu equipo.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [businessId, user]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, load]);

  function openAdd() {
    setEditing(null);
    setName('');
    setRole('editor');
    setModalVisible(true);
  }

  function openEdit(m) {
    setEditing(m);
    setName(m.name || '');
    setRole(TEAM_ROLES.some((r) => r.value === m.role) ? m.role : 'editor');
    setModalVisible(true);
  }

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Falta el nombre', 'Poné el nombre del integrante.');
      return;
    }
    if (!TEAM_ROLES.some((r) => r.value === role) || !allowedRoles.some((r) => r.value === role)) {
      Alert.alert('Rol no permitido', 'No podés asignar ese rol con tu nivel de acceso.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateTeamMember(editing.id, { name: name.trim(), role });
      } else {
        await api.addTeamMember({
          business_id: Number(businessId),
          name: name.trim(),
          role,
        });
      }
      setModalVisible(false);
      await load();
    } catch (e) {
      Alert.alert('No se pudo guardar', e.message || 'Intentá de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(m) {
    Alert.alert(
      'Quitar del equipo',
      `¿Sacar a ${m.name} de tu equipo?`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Sí, quitar',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.removeTeamMember(m.id);
              await load();
            } catch (e) {
              Alert.alert('Error', e.message || 'No se pudo quitar.');
            }
          },
        },
      ]
    );
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Equipo" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : team.length === 0 ? (
          <Card>
            <Text style={styles.empty}>
              Todavía no cargaste a tu equipo.{'\n'}Agregá a quienes atienden para que los
              clientes puedan elegirlos al reservar.
            </Text>
          </Card>
        ) : (
          team.map((m) => (
            <Card key={m.id} style={styles.memberRow}>
              <View style={[styles.avatar, { backgroundColor: avatarColor(m.name) }]}>
                <Text style={styles.avatarText}>{initials(m.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.mName}>{m.name}</Text>
                {!!m.role && <Text style={styles.mRole}>{roleLabel(m.role)}</Text>}
              </View>
              {canEdit && (
                <TouchableOpacity onPress={() => openEdit(m)} hitSlop={12}>
                  <Text style={styles.action}>Editar</Text>
                </TouchableOpacity>
              )}
              {canDelete && (
                <TouchableOpacity onPress={() => confirmDelete(m)} hitSlop={12}>
                  <Text style={[styles.action, styles.actionDanger]}>✕</Text>
                </TouchableOpacity>
              )}
            </Card>
          ))
        )}

        {myRole === 'lectura' && !loading && (
          <Card>
            <Text style={styles.readOnly}>
              Tenés acceso de lectura: podés ver el equipo pero no hacer cambios.
            </Text>
          </Card>
        )}

        {canAdd && (
          <PrimaryButton
            title="＋ Agregar integrante"
            variant="ghost"
            onPress={openAdd}
            style={{ minHeight: 52, borderRadius: 16, marginTop: spacing.md }}
          />
        )}
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.backdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}
          >
            <View style={styles.head}>
              <Text style={styles.title}>{editing ? 'Editar integrante' : 'Nuevo integrante'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={12} style={styles.close}>
                <Text style={styles.closeText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Nombre *</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Ej: Ana Gómez"
              placeholderTextColor={colors.muted}
            />
            <Text style={styles.label}>Rol de acceso *</Text>
            {TEAM_ROLES.map((r) => {
              const allowed = allowedRoles.some((a) => a.value === r.value);
              const selected = role === r.value;
              return (
                <TouchableOpacity
                  key={r.value}
                  style={[styles.roleCard, selected && styles.roleCardActive, !allowed && styles.roleCardDisabled]}
                  onPress={() => allowed && setRole(r.value)}
                  disabled={!allowed}
                  activeOpacity={0.85}
                >
                  <View style={styles.roleHead}>
                    <View style={[styles.radio, selected && styles.radioOn]}>
                      {selected && <View style={styles.radioDot} />}
                    </View>
                    <Text style={[styles.roleTitle, !allowed && styles.roleTextDisabled]}>
                      {r.label}
                      {!allowed ? ' (requiere ser administrador)' : ''}
                    </Text>
                  </View>
                  <Text style={[styles.roleDesc, !allowed && styles.roleTextDisabled]}>{r.desc}</Text>
                </TouchableOpacity>
              );
            })}
            <PrimaryButton
              title="Guardar"
              onPress={handleSave}
              loading={saving}
              style={{ minHeight: 52, borderRadius: 16, marginTop: spacing.lg }}
            />
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center', lineHeight: 20 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: fontSize.md },
  mName: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  mRole: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  action: { color: colors.primary, fontWeight: '700', fontSize: fontSize.sm, padding: 8 },
  actionDanger: { color: colors.danger },
  backdrop: { flex: 1, backgroundColor: 'rgba(26,26,46,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, maxHeight: '80%',
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
  readOnly: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  roleCard: {
    backgroundColor: colors.card, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, marginTop: 8,
  },
  roleCardActive: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.light },
  roleCardDisabled: { opacity: 0.6 },
  roleHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm,
  },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  roleTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, flex: 1 },
  roleDesc: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2, lineHeight: 20 },
  roleTextDisabled: { color: colors.muted },
});
