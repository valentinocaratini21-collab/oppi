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
  Modal,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Cupones del negocio (ruta "BusinessCoupons", params {businessId}).
 * Listar, crear y pausar/activar cupones de descuento.
 *
 * Contrato backend:
 *   GET  /api/businesses/:id/coupons          → { coupons }
 *   POST /api/businesses/:id/coupons           → { coupon }  (code, discount_gs)
 *   PATCH /api/coupons/:id { active }          → pausar / activar
 *   POST /api/coupons/validate { code, business_id, service_id } → { valid, discount_gs }
 * El cliente valida el cupón en el checkout (BookingFlowScreen) antes de pagar.
 */
export function BusinessCouponsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { businessId } = route.params;
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState(null);

  // Modal de creación
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [discount, setDiscount] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.businessCoupons(businessId);
      setCoupons(data.coupons || []);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar los cupones.');
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

  async function toggleActive(c) {
    setActingId(c.id);
    try {
      await api.setCouponActive(c.id, !c.active);
      await load();
    } catch (e) {
      Alert.alert('Error', e.message || 'No se pudo cambiar el estado del cupón.');
    } finally {
      setActingId(null);
    }
  }

  async function create() {
    const cleanCode = code.trim().toUpperCase();
    const discountGs = parseInt(discount.replace(/[^0-9]/g, ''), 10);
    if (!cleanCode) {
      Alert.alert('Falta el código', 'Ponele un código corto, ej. BIENVENIDO10.');
      return;
    }
    if (!Number.isInteger(discountGs) || discountGs <= 0) {
      Alert.alert('Falta el descuento', 'Poné el descuento en guaraníes, ej. 10000.');
      return;
    }
    setCreating(true);
    try {
      await api.createCoupon(businessId, { code: cleanCode, discount_gs: discountGs });
      setOpen(false);
      setCode('');
      setDiscount('');
      await load();
      Alert.alert('¡Listo! 🎟️', `El cupón ${cleanCode} ya está activo. Compartilo con tus clientes.`);
    } catch (e) {
      Alert.alert('No se pudo crear el cupón', e.message || 'Intentá de nuevo.');
    } finally {
      setCreating(false);
    }
  }

  const active = coupons.filter((c) => c.active);
  const paused = coupons.filter((c) => !c.active);

  return (
    <View style={styles.wrap}>
      <ScreenHeader
        title="Cupones"
        onBack={() => navigation.goBack()}
        right={
          <TouchableOpacity onPress={() => setOpen(true)} hitSlop={12}>
            <Text style={styles.add}>＋ Nuevo</Text>
          </TouchableOpacity>
        }
      />
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
            <Card style={styles.info}>
              <Text style={styles.infoTitle}>🎟️ Descuentos para tus clientes</Text>
              <Text style={styles.infoSub}>
                Creá cupones con un código y un descuento en guaraníes. El cliente los
                ingresa antes de pagar y el descuento se aplica al total. Pausá un cupón
                cuando ya no lo quieras repartir.
              </Text>
            </Card>

            {coupons.length === 0 && (
              <Card>
                <Text style={styles.empty}>
                  Todavía no creaste cupones. Tocá "＋ Nuevo" para crear el primero.
                </Text>
              </Card>
            )}

            {active.length > 0 && <Text style={styles.sec}>Activos ({active.length})</Text>}
            {active.map((c) => (
              <Card key={c.id}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.code}>{c.code}</Text>
                    <Text style={styles.discount}>−{gs(c.discount_gs)} en el total</Text>
                    {c.used_count != null && (
                      <Text style={styles.meta}>
                        Usado {c.used_count} {Number(c.used_count) === 1 ? 'vez' : 'veces'}
                      </Text>
                    )}
                  </View>
                  <View style={styles.badgeOk}>
                    <Text style={styles.badgeOkText}>Activo</Text>
                  </View>
                </View>
                <PrimaryButton
                  title={actingId === c.id ? '…' : '⏸ Pausar'}
                  variant="ghost"
                  onPress={() => toggleActive(c)}
                  disabled={actingId === c.id}
                  style={styles.toggle}
                />
              </Card>
            ))}

            {paused.length > 0 && <Text style={styles.sec}>Pausados ({paused.length})</Text>}
            {paused.map((c) => (
              <Card key={c.id} style={styles.paused}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.code}>{c.code}</Text>
                    <Text style={styles.discount}>−{gs(c.discount_gs)} en el total</Text>
                  </View>
                  <View style={styles.badgeOff}>
                    <Text style={styles.badgeOffText}>Pausado</Text>
                  </View>
                </View>
                <PrimaryButton
                  title={actingId === c.id ? '…' : '▶ Activar'}
                  variant="secondary"
                  onPress={() => toggleActive(c)}
                  disabled={actingId === c.id}
                  style={styles.toggle}
                />
              </Card>
            ))}
          </>
        )}
      </ScrollView>

      {/* Modal: crear cupón */}
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Nuevo cupón</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={10}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Código (lo que escribe el cliente)</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="Ej. BIENVENIDO10"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              maxLength={20}
            />
            <Text style={styles.fieldLabel}>Descuento (Gs.)</Text>
            <TextInput
              style={styles.input}
              value={discount}
              onChangeText={(t) => setDiscount(t.replace(/[^0-9]/g, ''))}
              placeholder="Ej. 10000"
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
            />
            <Text style={styles.hint}>
              El cliente ingresa el código antes de pagar y se le descuenta{' '}
              {discount ? gs(discount) : 'el monto'} del total.
            </Text>
            <PrimaryButton
              title="Crear cupón"
              onPress={create}
              loading={creating}
              style={styles.modalCta}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  add: { color: colors.primary, fontWeight: '800', fontSize: fontSize.md },
  info: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  infoTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  infoSub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 6, lineHeight: 20 },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
  sec: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center' },
  code: { fontSize: fontSize.lg, fontWeight: '900', color: colors.text, letterSpacing: 1 },
  discount: { fontSize: fontSize.md, fontWeight: '800', color: colors.primary, marginTop: 4 },
  meta: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  badgeOk: { backgroundColor: '#E6F7ED', borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12 },
  badgeOkText: { color: colors.success, fontSize: fontSize.xs, fontWeight: '800' },
  badgeOff: { backgroundColor: colors.bg, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border },
  badgeOffText: { color: colors.muted, fontSize: fontSize.xs, fontWeight: '800' },
  paused: { opacity: 0.7 },
  toggle: { minHeight: 44, marginTop: spacing.sm },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, maxHeight: '85%',
  },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  modalClose: { fontSize: 20, color: colors.muted, padding: 4 },
  fieldLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.muted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.bg, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, fontSize: fontSize.md, color: colors.text,
  },
  hint: { fontSize: fontSize.sm, color: colors.muted, marginTop: spacing.sm, lineHeight: 20 },
  modalCta: { height: 52, borderRadius: 16, marginTop: spacing.lg },
});
