import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useAuth } from '../../store/AuthContext';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ScreenHeader } from '../../components/ScreenHeader';
import { colors, fontSize, spacing, radius } from '../../theme';

/** Registro contra POST /api/auth/register. Roles: client | pro | handyman | business. */
const ROLES = [
  { value: 'client', title: 'Cliente', desc: 'Quiero reservar servicios' },
  { value: 'pro', title: 'Profesional', desc: 'Ofrezco mis servicios' },
  { value: 'handyman', title: 'Handyman', desc: 'Quiero ganar plata con changas' },
  { value: 'business', title: 'Negocio', desc: 'Tengo un local y quiero recibir reservas' },
];

export function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('client');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    if (!name.trim() || !email.trim() || !password) {
      Alert.alert('Faltan datos', 'Completá nombre, email y contraseña.');
      return;
    }
    if (!acceptedTerms) {
      Alert.alert(
        'Aceptá los términos',
        'Para crear tu cuenta tenés que aceptar los Términos de uso y la Política de privacidad.'
      );
      return;
    }
    setLoading(true);
    try {
      // El AuthContext marca el rol recién registrado; al cambiar isLoggedIn
      // el RootNavigator monta el MainStack y RoleGate (pantalla puente)
      // redirige UNA SOLA VEZ: business → BusinessOnboarding,
      // pro → MyServices, handyman → HandymanHome, client → MainTabs.
      // (Un replace() directo desde este AuthStack no resuelve: esas rutas
      // viven en el stack principal, no en este.)
      await register({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password,
        role,
        terms_accepted: true,
      });
    } catch (e) {
      Alert.alert('No pudimos crear tu cuenta', e.message || 'Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="Crear cuenta" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Nombre y apellido</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Ana Duarte" placeholderTextColor={colors.muted} />

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="ana@ejemplo.com.py"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text style={styles.label}>Teléfono (opcional)</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="0981 000 000"
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
        />

        <Text style={styles.label}>Contraseña (mínimo 6 caracteres)</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••"
          placeholderTextColor={colors.muted}
          secureTextEntry
        />

        <Text style={styles.label}>¿Qué querés hacer en Oppi?</Text>
        {ROLES.map((r) => (
          <TouchableOpacity
            key={r.value}
            style={[styles.roleCard, role === r.value && styles.roleCardActive]}
            onPress={() => setRole(r.value)}
          >
            <Text style={[styles.roleTitle, role === r.value && styles.roleTextActive]}>{r.title}</Text>
            <Text style={[styles.roleDesc, role === r.value && styles.roleTextActive]}>{r.desc}</Text>
          </TouchableOpacity>
        ))}

        <View style={styles.termsRow}>
          <TouchableOpacity
            style={[styles.checkbox, acceptedTerms && styles.checkboxOn]}
            onPress={() => setAcceptedTerms((v) => !v)}
            activeOpacity={0.85}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: acceptedTerms }}
          >
            {acceptedTerms && <Text style={styles.checkMark}>✓</Text>}
          </TouchableOpacity>
          <Text style={styles.termsText}>
            Acepto los{' '}
            <Text style={styles.termsLink} onPress={() => navigation.navigate('Terms')}>
              Términos de uso
            </Text>{' '}
            y la{' '}
            <Text style={styles.termsLink} onPress={() => navigation.navigate('Privacy')}>
              Política de privacidad
            </Text>
          </Text>
        </View>

        <PrimaryButton title="Crear mi cuenta" onPress={onSubmit} loading={loading} style={styles.cta} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.lg },
  label: { fontSize: fontSize.sm, fontWeight: '700', color: colors.text, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    fontSize: fontSize.md,
    color: colors.text,
  },
  roleCard: {
    backgroundColor: colors.card,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginTop: 8,
  },
  roleCardActive: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.light },
  roleTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  roleDesc: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  roleTextActive: { color: colors.primary },
  cta: { marginTop: spacing.lg, marginBottom: spacing.lg },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.lg },
  checkbox: {
    width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm, marginTop: 2,
  },
  checkboxOn: { backgroundColor: colors.primary },
  checkMark: { color: '#fff', fontWeight: '900', fontSize: 16 },
  termsText: { flex: 1, fontSize: fontSize.sm, color: colors.text, lineHeight: 22 },
  termsLink: { color: colors.primary, fontWeight: '700', textDecorationLine: 'underline' },
});
