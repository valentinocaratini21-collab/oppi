import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { Card } from '../components/Card';
import { TaxonomyPicker } from '../components/TaxonomyPicker';
import { gs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/**
 * Alta progresiva del negocio (ruta "BusinessOnboarding"):
 *  1. Datos del negocio
 *  2. Primer servicio
 *  3. Horarios
 *  4. "Cómo ganamos" → Publicar (POST /api/businesses)
 *
 * Al crearse queda con verification_status='pending' (badge "En verificación").
 * Los documentos se suben DESPUÉS desde el panel, sin bloquear la publicación.
 *
 * NOTA backend: POST /api/businesses acepta {name, ruc, categories, barrio,
 * address, services:[{name, price_gs, deposit_type, deposit_value}], schedule}.
 * `phone` se manda igual (el backend hoy lo ignora; queda para cuando agregue
 * la columna) y los servicios no tienen duración en el backend.
 */
const STEPS = ['Tu negocio', 'Servicios', 'Horarios', 'Cómo ganamos'];

export function BusinessOnboardingScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const { fromRegistration } = route.params || {};
  const [step, setStep] = useState(1);
  const [checking, setChecking] = useState(true);
  const [publishing, setPublishing] = useState(false);

  // Paso 1
  const [name, setName] = useState('');
  const [taxonomy, setTaxonomy] = useState({});
  const [barrio, setBarrio] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [ruc, setRuc] = useState('');

  // Paso 2
  const [services, setServices] = useState([]);
  const [sName, setSName] = useState('');
  const [sPrice, setSPrice] = useState('');
  const [svcError, setSvcError] = useState('');

  // Paso 3
  const [hours, setHours] = useState(
    DAYS.map((d) => ({ day: d, enabled: d !== 'Dom', open: '09:00', close: '18:00' }))
  );

  // Si ya tiene negocio, directo al panel.
  useEffect(() => {
    (async () => {
      try {
        const { businesses } = await api.businesses();
        const mine = (businesses || []).find((b) => b.user_id === user?.id);
        if (mine) navigation.replace('MyBusiness');
      } catch {
        // Sin conexión: se sigue con el alta igual.
      } finally {
        setChecking(false);
      }
    })();
  }, [navigation, user]);

  function addService() {
    const price = parseInt(sPrice, 10);
    if (!sName.trim()) {
      setSvcError('Poné el nombre del servicio.');
      return;
    }
    if (!Number.isInteger(price) || price <= 0) {
      setSvcError('El precio tiene que ser un monto en guaraníes mayor a 0.');
      return;
    }
    setSvcError('');
    setServices((prev) => [
      ...prev,
      {
        name: sName.trim(),
        price_gs: price,
        // Pago 100%: sin seña (el backend conserva el contrato).
        deposit_type: 'none',
        deposit_value: 0,
      },
    ]);
    setSName('');
    setSPrice('');
  }

  function toggleDay(day) {
    setHours((prev) => prev.map((h) => (h.day === day ? { ...h, enabled: !h.enabled } : h)));
  }

  function setHour(day, field, value) {
    setHours((prev) => prev.map((h) => (h.day === day ? { ...h, [field]: value } : h)));
  }

  async function publish() {
    if (publishing) return;
    setPublishing(true);
    try {
      const schedule = hours
        .filter((h) => h.enabled)
        .map((h) => ({ day: h.day, open: h.open, close: h.close }));
      await api.createBusiness({
        name: name.trim(),
        ruc: ruc.trim(),
        categories: (taxonomy.professionName || taxonomy.categoryName)
          ? [taxonomy.professionName || taxonomy.categoryName]
          : [],
        barrio: barrio.trim(),
        address: address.trim(),
        phone: phone.trim(),
        services,
        schedule,
      });
      await refreshUser().catch(() => {});
      navigation.replace('MyBusiness');
    } catch (e) {
      Alert.alert('No pudimos publicar tu negocio', e.message || 'Intentá de nuevo.');
    } finally {
      setPublishing(false);
    }
  }

  const canContinue1 = name.trim().length > 0;
  const firstService = services[0];
  const commission = firstService ? Math.round(firstService.price_gs * 0.15) : 0;

  if (checking) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title="Registrá tu negocio"
        // Recién registrado: detrás no hay nada → el atrás va a las tabs.
        onBack={() =>
          step === 1
            ? fromRegistration
              ? navigation.replace('MainTabs')
              : navigation.goBack()
            : setStep(step - 1)
        }
      />

      {/* Indicador de pasos */}
      <View style={styles.steps}>
        {STEPS.map((label, i) => (
          <View key={label} style={styles.stepItem}>
            <View style={[styles.dot, step > i && styles.dotActive]}>
              <Text style={[styles.dotText, step > i && styles.dotTextActive]}>
                {step > i + 1 ? '✓' : i + 1}
              </Text>
            </View>
            <Text style={[styles.stepLabel, step > i && styles.stepLabelActive]}>{label}</Text>
          </View>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        {step === 1 && (
          <>
            <Text style={styles.h1}>Tu negocio</Text>
            <Text style={styles.sub}>Paso 1 de 4 · Lo básico para publicar ya mismo.</Text>

            <Text style={styles.label}>Nombre del negocio *</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName}
              placeholder="Ej: Pelo & Arte" placeholderTextColor={colors.muted} />

            <TaxonomyPicker label="Rubro" value={taxonomy} onChange={setTaxonomy} />

            <Text style={styles.label}>Barrio</Text>
            <TextInput style={styles.input} value={barrio} onChangeText={setBarrio}
              placeholder="Ej: Villa Morra" placeholderTextColor={colors.muted} />

            <Text style={styles.label}>Dirección</Text>
            <TextInput style={styles.input} value={address} onChangeText={setAddress}
              placeholder="Ej: Av. Mariscal López 2024" placeholderTextColor={colors.muted} />

            <Text style={styles.label}>WhatsApp / teléfono</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone}
              placeholder="0981 000 000" placeholderTextColor={colors.muted} keyboardType="phone-pad" />

            <Text style={styles.label}>RUC (opcional, lo pedimos para verificarte)</Text>
            <TextInput style={styles.input} value={ruc} onChangeText={setRuc}
              placeholder="80000000-1" placeholderTextColor={colors.muted} />

            <PrimaryButton
              title="Continuar"
              disabled={!canContinue1}
              onPress={() => setStep(2)}
              style={styles.cta}
            />
            {!canContinue1 && <Text style={styles.hint}>Poné al menos el nombre de tu negocio.</Text>}
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.h1}>Tus servicios</Text>
            <Text style={styles.sub}>Paso 2 de 4 · Con uno solo ya podés publicar.</Text>

            {services.map((s, i) => (
              <Card key={i} style={styles.svcRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.svcName}>{s.name}</Text>
                  <Text style={styles.svcSub}>{gs(s.price_gs)}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setServices((prev) => prev.filter((_, j) => j !== i))}
                  hitSlop={12}
                >
                  <Text style={styles.remove}>✕</Text>
                </TouchableOpacity>
              </Card>
            ))}

            <Card>
              <Text style={styles.cardTitle}>Agregar servicio</Text>
              <Text style={styles.label}>Nombre *</Text>
              <TextInput style={styles.input} value={sName} onChangeText={setSName}
                placeholder="Ej: Corte mujer" placeholderTextColor={colors.muted} />
              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Precio (Gs.) *</Text>
                  <TextInput style={[styles.input, !!svcError && styles.inputError]} value={sPrice}
                    onChangeText={(t) => setSPrice(t.replace(/[^0-9]/g, ''))}
                    placeholder="85000" placeholderTextColor={colors.muted} keyboardType="numeric" />
                </View>
              </View>
              <Text style={styles.hint}>El cliente paga el 100% al reservar.</Text>
              {!!svcError && <Text style={styles.error}>⚠ {svcError}</Text>}
              <PrimaryButton title="＋ Agregar servicio" variant="ghost" onPress={addService} />
            </Card>

            <PrimaryButton
              title="Continuar"
              disabled={services.length === 0}
              onPress={() => setStep(3)}
              style={styles.cta}
            />
            {services.length === 0 && (
              <Text style={styles.hint}>Agregá al menos un servicio para seguir.</Text>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <Text style={styles.h1}>Horarios</Text>
            <Text style={styles.sub}>Paso 3 de 4 · ¿Cuándo atendés?</Text>

            {hours.map((h) => (
              <Card key={h.day} style={styles.dayRow}>
                <TouchableOpacity style={styles.dayToggle} onPress={() => toggleDay(h.day)}>
                  <View style={[styles.check, h.enabled && styles.checkOn]}>
                    {h.enabled && <Text style={styles.checkText}>✓</Text>}
                  </View>
                  <Text style={styles.dayName}>{h.day}</Text>
                </TouchableOpacity>
                {h.enabled ? (
                  <View style={styles.hoursRow}>
                    <TextInput
                      style={styles.hourInput}
                      value={h.open}
                      onChangeText={(t) => setHour(h.day, 'open', t)}
                      placeholder="09:00"
                      placeholderTextColor={colors.muted}
                    />
                    <Text style={styles.dash}>–</Text>
                    <TextInput
                      style={styles.hourInput}
                      value={h.close}
                      onChangeText={(t) => setHour(h.day, 'close', t)}
                      placeholder="18:00"
                      placeholderTextColor={colors.muted}
                    />
                  </View>
                ) : (
                  <Text style={styles.closed}>Cerrado</Text>
                )}
              </Card>
            ))}

            <PrimaryButton title="Continuar" onPress={() => setStep(4)} style={styles.cta} />
          </>
        )}

        {step === 4 && (
          <>
            <Text style={styles.h1}>Cómo ganamos</Text>
            <Text style={styles.sub}>Paso 4 de 4 · Transparente desde el día uno.</Text>

            <Card style={styles.commissionCard}>
              <Text style={styles.commissionTitle}>Oppi cobra 15%</Text>
              <Text style={styles.commissionText}>
                Solo cuando la reserva se concreta. Sin costos fijos, sin suscripción, sin letra chica.
              </Text>
              {firstService && (
                <View style={styles.example}>
                  <Text style={styles.exampleTitle}>Ejemplo con "{firstService.name}"</Text>
                  <Text style={styles.exampleRow}>Precio: {gs(firstService.price_gs)}</Text>
                  <Text style={styles.exampleRow}>Comisión Oppi (15%): {gs(commission)}</Text>
                  <Text style={styles.exampleRowBold}>Vos recibís: {gs(firstService.price_gs - commission)}</Text>
                </View>
              )}
            </Card>

            <Card>
              <Text style={styles.cardTitle}>📄 Tus documentos</Text>
              <Text style={styles.cardText}>
                El RUC, la habilitación y tu cédula los subís después desde el panel, cuando quieras.
                Publicás igual con el badge "En verificación".
              </Text>
            </Card>

            <PrimaryButton
              title="🚀 Publicar mi negocio"
              onPress={publish}
              loading={publishing}
              style={styles.cta}
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  steps: {
    flexDirection: 'row', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm, backgroundColor: colors.bg,
  },
  stepItem: { alignItems: 'center', gap: 4, minWidth: 64 },
  dot: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  dotActive: { backgroundColor: colors.primary },
  dotText: { color: colors.muted, fontWeight: '800', fontSize: fontSize.sm },
  dotTextActive: { color: '#fff' },
  stepLabel: { fontSize: 10, color: colors.muted, textAlign: 'center' },
  stepLabelActive: { color: colors.primary, fontWeight: '700' },
  inner: { padding: spacing.lg },
  h1: { fontSize: fontSize.xl, fontWeight: '900', color: colors.text },
  sub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4, marginBottom: spacing.md },
  label: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.card, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, fontSize: fontSize.md, color: colors.text,
  },
  inputError: { borderColor: colors.danger, borderWidth: 2 },
  cta: { marginTop: spacing.lg, marginBottom: spacing.sm, minHeight: 52, borderRadius: 16 },
  hint: { textAlign: 'center', color: colors.muted, fontSize: fontSize.sm },
  error: {
    fontSize: fontSize.sm, color: colors.danger, fontWeight: '700',
    backgroundColor: '#FDECEC', borderRadius: radius.button, padding: 10, marginTop: spacing.sm,
  },
  row2: { flexDirection: 'row', gap: spacing.sm },
  svcRow: { flexDirection: 'row', alignItems: 'center' },
  svcName: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  svcSub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  remove: { fontSize: fontSize.md, color: colors.danger, fontWeight: '700', padding: 8 },
  cardTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: spacing.sm },
  cardText: { fontSize: fontSize.sm, color: colors.muted, lineHeight: 20 },
  dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dayToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  check: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkText: { color: '#fff', fontWeight: '800' },
  dayName: { fontSize: fontSize.md, fontWeight: '700', color: colors.text, width: 44 },
  hoursRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hourInput: {
    backgroundColor: colors.bg, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 10, fontSize: fontSize.md, color: colors.text, width: 76,
    textAlign: 'center',
  },
  dash: { color: colors.muted, fontSize: fontSize.md },
  closed: { fontSize: fontSize.sm, color: colors.muted, fontStyle: 'italic' },
  commissionCard: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  commissionTitle: { fontSize: fontSize.lg, fontWeight: '900', color: colors.text },
  commissionText: { fontSize: fontSize.sm, color: colors.muted, marginTop: 6, lineHeight: 20 },
  example: {
    marginTop: spacing.md, backgroundColor: colors.bg, borderRadius: radius.button, padding: spacing.md,
  },
  exampleTitle: { fontSize: fontSize.sm, fontWeight: '800', color: colors.text, marginBottom: 6 },
  exampleRow: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  exampleRowBold: { fontSize: fontSize.md, color: colors.success, fontWeight: '800', marginTop: 6 },
});
