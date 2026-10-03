import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Detalle de servicio (ruta "ServiceDetail").
 *
 * Params: { service, proId?, proName?, businessId?, businessName? }.
 * Muestra foto (o placeholder), descripción, "Incluye" con ✓, duración y
 * precio — y [Reservar] que abre el BookingFlow con el servicio ya elegido.
 * Pago 100%: el cliente paga el total al confirmar (simulado por ahora).
 */
export function ServiceDetailScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { service, proId, proName, businessId, businessName } = route.params || {};

  if (!service) {
    return (
      <View style={styles.wrap}>
        <ScreenHeader title="Servicio" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>😕</Text>
          <Text style={styles.emptyTitle}>No encontramos ese servicio</Text>
          <Text style={styles.emptySub}>Volvé atrás y elegí otro.</Text>
          <PrimaryButton title="Volver" onPress={() => navigation.goBack()} />
        </View>
      </View>
    );
  }

  const includes = Array.isArray(service.includes)
    ? service.includes.filter((x) => String(x || '').trim())
    : [];
  const duration = service.duration_min
    ? `${service.duration_min} min`
    : 'Duración a convenir';

  function goToBooking() {
    if (businessId) {
      navigation.navigate('BookingFlow', { businessId, serviceId: service.id });
    } else if (proId) {
      navigation.navigate('BookingFlow', {
        proId,
        services: [service],
        serviceId: service.id,
        proName,
      });
    } else {
      navigation.navigate('BookingFlow', { services: [service], serviceId: service.id });
    }
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader
        title={service.name || 'Servicio'}
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
      >
        {service.photo_url ? (
          <Image source={{ uri: service.photo_url }} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Text style={styles.photoEmoji}>💈</Text>
          </View>
        )}

        <Text style={styles.name}>{service.name}</Text>
        {(proName || businessName) && (
          <Text style={styles.owner}>{proName || businessName}</Text>
        )}

        <Card>
          <View style={styles.priceRow}>
            <View>
              <Text style={styles.priceLabel}>Precio</Text>
              <Text style={styles.price}>{gs(service.price_gs)}</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>⏱ {duration}</Text>
          </View>
        </Card>

        {!!service.description && (
          <Card>
            <Text style={styles.secTitle}>Descripción</Text>
            <Text style={styles.description}>{service.description}</Text>
          </Card>
        )}

        {includes.length > 0 && (
          <Card>
            <Text style={styles.secTitle}>Incluye</Text>
            {includes.map((item, i) => (
              <View key={i} style={styles.includeRow}>
                <Text style={styles.check}>✓</Text>
                <Text style={styles.includeText}>{item}</Text>
              </View>
            ))}
          </Card>
        )}

        <PrimaryButton
          title="Reservar"
          onPress={goToBooking}
          style={{ minHeight: 52, borderRadius: 16, marginTop: spacing.md }}
        />
        <Text style={styles.hint}>
          Al confirmar, pagás el total: {gs(service.price_gs)} (pago simulado por ahora).
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: 12 },
  inner: { padding: spacing.md },
  photo: { width: '100%', height: 220, borderRadius: radius.card, marginBottom: spacing.md },
  photoPlaceholder: {
    width: '100%', height: 160, borderRadius: radius.card, backgroundColor: colors.light,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  photoEmoji: { fontSize: 64 },
  name: { fontSize: fontSize.xl, fontWeight: '900', color: colors.text },
  owner: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4, marginBottom: spacing.sm },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  priceLabel: { fontSize: fontSize.xs, color: colors.muted, fontWeight: '700' },
  price: { fontSize: fontSize.lg, fontWeight: '900', color: colors.text, marginTop: 2 },
  metaRow: { marginTop: spacing.sm },
  meta: { fontSize: fontSize.sm, color: colors.muted, fontWeight: '600' },
  secTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  description: { fontSize: fontSize.sm, color: colors.text, lineHeight: 22 },
  includeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.xs },
  check: { fontSize: fontSize.md, color: colors.success, fontWeight: '900' },
  includeText: { fontSize: fontSize.sm, color: colors.text, flex: 1, lineHeight: 20 },
  hint: { fontSize: fontSize.xs, color: colors.muted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 18 },
  emptyEmoji: { fontSize: 64 },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, textAlign: 'center' },
  emptySub: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center' },
});
