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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs, shortDate } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

const STATUS_STYLE = {
  paid: { bg: '#E6F7ED', fg: colors.success, label: 'Pagado' },
  pending: { bg: '#FFF4E0', fg: colors.warning, label: 'Pendiente' },
  refunded: { bg: colors.light, fg: colors.primary, label: 'Devuelto' },
  failed: { bg: colors.dangerSoft, fg: colors.danger, label: 'Falló' },
};

/**
 * Mis pagos (ruta "Payments"). Se entra desde Perfil → "Mis pagos".
 * GET /api/me/payments → { payments: [{ id, fecha, concepto, monto_gs, estado, booking_id?, tipo }] }
 * Lista + comprobante (modal) con el detalle de cada pago.
 */
export function PaymentsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.myPayments();
      setPayments(data.payments || []);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar tus pagos.');
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

  function statusOf(p) {
    return STATUS_STYLE[p.estado] || { bg: colors.bg, fg: colors.muted, label: p.estado || '—' };
  }

  function fecha(p) {
    if (!p.fecha) return '';
    const iso = String(p.fecha).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? shortDate(iso) : iso;
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Mis pagos" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : payments.length === 0 ? (
          <Card>
            <Text style={styles.empty}>
              Todavía no tenés pagos registrados. Cuando pagues un servicio,
              el comprobante aparece acá.
            </Text>
          </Card>
        ) : (
          payments.map((p) => {
            const st = statusOf(p);
            return (
              <TouchableOpacity key={p.id} onPress={() => setDetail(p)} activeOpacity={0.85}>
                <Card>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.concepto}>{p.concepto}</Text>
                      {fecha(p) ? <Text style={styles.meta}>{fecha(p)}</Text> : null}
                      {p.tipo ? <Text style={styles.meta}>{p.tipo}</Text> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.monto}>{gs(p.monto_gs)}</Text>
                      <View style={[styles.badge, { backgroundColor: st.bg }]}>
                        <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
                      </View>
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Comprobante */}
      <Modal
        visible={!!detail}
        animationType="slide"
        transparent
        onRequestClose={() => setDetail(null)}
      >
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Comprobante</Text>
              <TouchableOpacity onPress={() => setDetail(null)} hitSlop={10}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {detail && (
              <>
                <Text style={styles.detailConcepto}>{detail.concepto}</Text>
                <Text style={styles.detailMonto}>{gs(detail.monto_gs)}</Text>
                <View style={[styles.badge, { backgroundColor: statusOf(detail).bg, alignSelf: 'flex-start', marginTop: spacing.sm }]}>
                  <Text style={[styles.badgeText, { color: statusOf(detail).fg }]}>
                    {statusOf(detail).label}
                  </Text>
                </View>
                <View style={styles.detailRows}>
                  {detail.fecha && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailKey}>Fecha</Text>
                      <Text style={styles.detailVal}>{fecha(detail)}</Text>
                    </View>
                  )}
                  {detail.tipo && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailKey}>Tipo</Text>
                      <Text style={styles.detailVal}>{detail.tipo}</Text>
                    </View>
                  )}
                  {detail.booking_id && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailKey}>Reserva</Text>
                      <Text style={styles.detailVal}>#{detail.booking_id}</Text>
                    </View>
                  )}
                  <View style={styles.detailRow}>
                    <Text style={styles.detailKey}>Comprobante</Text>
                    <Text style={styles.detailVal}>#{detail.id}</Text>
                  </View>
                </View>
                <Text style={styles.note}>
                  Guardá este comprobante: es tu respaldo ante cualquier reclamo.
                </Text>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center', lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center' },
  concepto: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  meta: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  monto: { fontSize: fontSize.md, fontWeight: '900', color: colors.text },
  badge: { borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10, marginTop: 6 },
  badgeText: { fontSize: fontSize.xs, fontWeight: '800' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, maxHeight: '85%',
  },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  modalClose: { fontSize: 20, color: colors.muted, padding: 4 },
  detailConcepto: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  detailMonto: { fontSize: fontSize.xl, fontWeight: '900', color: colors.primary, marginTop: spacing.sm },
  detailRows: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  detailKey: { fontSize: fontSize.sm, color: colors.muted },
  detailVal: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text },
  note: { fontSize: fontSize.xs, color: colors.muted, marginTop: spacing.md, textAlign: 'center', lineHeight: 18 },
});
