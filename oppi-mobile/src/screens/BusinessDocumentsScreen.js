import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { pickAndUpload } from '../utils/photos';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Documentos del negocio (ruta "BusinessDocuments", params {businessId}).
 * Checklist progresivo: RUC, habilitación municipal, cédula.
 *
 * Flujo: [Subir] → se elige la foto (pickAndUpload real) → POST
 * /api/businesses/:id/documents {type} → queda "En revisión".
 * El botón "simular" marca la subida sin foto (mock claro) y
 * "Simular aprobación" refleja el PATCH que en producción hace un
 * revisor de Oppi.
 */
const DOC_TYPES = [
  { type: 'ruc', label: 'RUC', desc: 'Constancia de tu RUC' },
  { type: 'habilitacion', label: 'Habilitación municipal', desc: 'Patente o habilitación de tu local' },
  { type: 'identidad', label: 'Cédula de identidad', desc: 'Del titular del negocio' },
];

const STATUS = {
  pending: { label: 'En revisión', bg: '#FFF4E0', fg: colors.warning },
  approved: { label: 'Aprobado', bg: '#E6F7ED', fg: colors.success },
  rejected: { label: 'Rechazado', bg: '#FDECEC', fg: colors.danger },
};

export function BusinessDocumentsScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { businessId } = route.params;
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(null);

  const load = useCallback(async () => {
    try {
      const { documents } = await api.businessDocuments(businessId);
      setDocs(documents || []);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar tus documentos.');
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

  const byType = {};
  for (const d of docs) byType[d.type] = d;

  async function submitType(type, simulated) {
    setUploading(type);
    try {
      if (!simulated) {
        const res = await pickAndUpload();
        if (res.canceled) return;
      }
      await api.uploadBusinessDocument(businessId, { type });
      await load();
    } catch (e) {
      // Si falla el picker/subida real, ofrecer el mock claro.
      Alert.alert(
        'No pudimos subir la foto',
        `${e.message || 'Hubo un problema.'} ¿Querés marcarlo como enviado igual (simulado)?`,
        [
          { text: 'No', style: 'cancel' },
          {
            text: 'Sí, simular envío',
            onPress: async () => {
              try {
                await api.uploadBusinessDocument(businessId, { type });
                await load();
              } catch (err) {
                Alert.alert('Error', err.message || 'No se pudo registrar.');
              }
            },
          },
        ]
      );
    } finally {
      setUploading(null);
    }
  }

  async function simulateApproval(doc) {
    try {
      await api.updateBusinessDocument(businessId, doc.id, { status: 'approved' });
      await load();
    } catch (e) {
      Alert.alert('Error', e.message || 'No se pudo actualizar.');
    }
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Documentos" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <Text style={styles.intro}>
          Subilos cuando quieras: tu negocio ya está publicado con el badge "En verificación".
          Cuando Oppi los revise, pasás a "Verificado".
        </Text>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : (
          DOC_TYPES.map((dt) => {
            const doc = byType[dt.type];
            const st = doc ? STATUS[doc.status] || STATUS.pending : null;
            return (
              <Card key={dt.type}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docName}>{dt.label}</Text>
                    <Text style={styles.docDesc}>{dt.desc}</Text>
                  </View>
                  {st ? (
                    <View style={[styles.badge, { backgroundColor: st.bg }]}>
                      <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
                    </View>
                  ) : (
                    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
                      <Text style={[styles.badgeText, { color: colors.muted }]}>Pendiente</Text>
                    </View>
                  )}
                </View>

                {!doc && (
                  <View style={styles.actions}>
                    <PrimaryButton
                      title={uploading === dt.type ? 'Subiendo…' : '📤 Subir foto'}
                      onPress={() => submitType(dt.type, false)}
                      disabled={!!uploading}
                      style={styles.btn}
                    />
                    <TouchableOpacity onPress={() => submitType(dt.type, true)} disabled={!!uploading}>
                      <Text style={styles.mockLink}>o simular envío</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {doc && doc.status === 'pending' && (
                  <TouchableOpacity onPress={() => simulateApproval(doc)}>
                    <Text style={styles.mockLink}>Simular aprobación (demo)</Text>
                  </TouchableOpacity>
                )}
                {doc && doc.status === 'rejected' && (
                  <Text style={styles.rejected}>
                    Lo rechazamos: subí una foto más legible.
                  </Text>
                )}
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
  inner: { padding: spacing.md },
  intro: { fontSize: fontSize.sm, color: colors.muted, lineHeight: 20, marginBottom: spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  docName: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  docDesc: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  badge: { borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12 },
  badgeText: { fontSize: fontSize.xs, fontWeight: '800' },
  actions: { marginTop: spacing.sm },
  btn: { minHeight: 48 },
  mockLink: { color: colors.primary, fontSize: fontSize.sm, fontWeight: '600', marginTop: spacing.sm, textAlign: 'center' },
  rejected: { color: colors.danger, fontSize: fontSize.sm, marginTop: spacing.sm },
});
