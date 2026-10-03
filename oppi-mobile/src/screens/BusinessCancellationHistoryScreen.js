import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { ScreenHeader } from '../components/ScreenHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { WildcardDots } from '../components/WildcardDots';
import { dateEs, dateTimeEs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Historial de cancelaciones del negocio (Oppi Empresas).
 *
 * Params: { businessId }
 * GET /api/businesses/:id/cancellation-history → { history, wildcards }
 *
 * - Comodines de la cuenta (puntitos)
 * - Lista de cancelaciones: fecha, servicio, cliente, motivo, resolución
 * - Descargar CSV: NO se simula — se explica que se descarga desde la web.
 */
const RESOLUCION_LABEL = {
  gratis: 'Gratis',
  comodin: '1 comodín',
  sin_comodin: 'Sin comodín (bajó cumplimiento)',
  no_show: 'No-show',
};

export function BusinessCancellationHistoryScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { businessId } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [wildcards, setWildcards] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.businessCancellationHistory(businessId);
      setHistory(res.history || res.cancellations || []);
      setWildcards(res.wildcards || res.comodines || null);
    } catch (e) {
      setError(e.message || 'No pudimos cargar el historial.');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  function downloadCsv() {
    // No se simula: el CSV real vive en la versión web.
    Alert.alert(
      'Descargar CSV',
      'El archivo CSV se descarga desde la versión web de Oppi (Mi negocio → Cancelaciones). Acá ves el historial completo.',
      [{ text: 'Entendido' }]
    );
  }

  const balance = Number(wildcards?.balance ?? 3);

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Historial de cancelaciones" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}>
        {loading && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />}

        {!loading && error && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>😕 Algo salió mal</Text>
            <Text style={styles.cardText}>{error}</Text>
            <PrimaryButton title="Reintentar" onPress={load} style={{ marginTop: spacing.sm }} />
          </View>
        )}

        {!loading && !error && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🎟️ Comodines de la cuenta</Text>
              <View style={styles.dotsRow}>
                <WildcardDots balance={balance} size={22} />
                <Text style={styles.dotsLabel}>{balance} de 3</Text>
              </View>
              {wildcards?.proximo_en ? (
                <Text style={styles.cardText}>Próximo comodín {wildcards.proximo_en} de 10 reservas</Text>
              ) : null}
              {wildcards?.reset_fecha ? (
                <Text style={styles.cardText}>Se resetean el {dateEs(wildcards.reset_fecha)}</Text>
              ) : null}
            </View>

            {history.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.empty}>🎉 Sin cancelaciones registradas. Así se hace.</Text>
              </View>
            ) : (
              history.map((h, i) => (
                <View key={h.id || i} style={styles.card}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.itemTitle}>{h.service_name || h.servicio || 'Servicio'}</Text>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor:
                            h.resolucion === 'gratis' ? '#E6F7ED' : h.resolucion === 'no_show' ? colors.dangerSoft : '#FFF4E0',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          {
                            color:
                              h.resolucion === 'gratis'
                                ? colors.success
                                : h.resolucion === 'no_show'
                                  ? colors.danger
                                  : colors.warning,
                          },
                        ]}
                      >
                        {RESOLUCION_LABEL[h.resolucion] || h.resolucion || '—'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.itemMeta}>
                    {(h.cancelled_at || h.fecha) ? dateTimeEs(h.cancelled_at || h.fecha) : ''}
                    {h.client_name || h.cliente ? ` · ${h.client_name || h.cliente}` : ''}
                  </Text>
                  {h.reason || h.motivo ? (
                    <Text style={styles.itemReason}>Motivo: {h.reason || h.motivo}</Text>
                  ) : null}
                </View>
              ))
            )}

            <PrimaryButton title="⬇️ Descargar CSV" variant="secondary" onPress={downloadCsv} style={styles.csvBtn} />
            <Text style={styles.fine}>El CSV se genera en la versión web de Oppi.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#1A1A2E',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  cardText: { fontSize: fontSize.sm, color: colors.muted, lineHeight: 20, marginTop: 4 },
  dotsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  dotsLabel: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  empty: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  itemTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, flex: 1 },
  badge: { borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 },
  badgeText: { fontSize: fontSize.xs, fontWeight: '800' },
  itemMeta: { fontSize: fontSize.xs, color: colors.muted, marginTop: 4 },
  itemReason: { fontSize: fontSize.sm, color: colors.text, marginTop: 6, lineHeight: 20 },
  csvBtn: { marginTop: spacing.sm },
  fine: { fontSize: fontSize.xs, color: colors.muted, textAlign: 'center', marginTop: spacing.sm },
});
