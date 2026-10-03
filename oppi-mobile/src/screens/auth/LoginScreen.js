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
} from 'react-native';
import { useAuth } from '../../store/AuthContext';
import { PrimaryButton } from '../../components/PrimaryButton';
import { colors, fontSize, spacing, radius } from '../../theme';

/** Login contra POST /api/auth/login (nada de mock). */
export function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    if (!email.trim() || !password) {
      Alert.alert('Faltan datos', 'Pasame tu email y contraseña.');
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
      // El AuthContext cambia isLoggedIn → el RootNavigator muestra MainTabs.
    } catch (e) {
      Alert.alert('No pudimos entrar', e.message || 'Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>Oppi</Text>
        <Text style={styles.subtitle}>Reservá servicios. Sin vueltas.</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          placeholder="ana@ejemplo.com.py"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <Text style={styles.label}>Contraseña</Text>
        <TextInput
          style={styles.input}
          placeholder="Tu contraseña"
          placeholderTextColor={colors.muted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={onSubmit}
        />

        <PrimaryButton title="Entrar" onPress={onSubmit} loading={loading} style={styles.cta} />
        <PrimaryButton
          title="Crear cuenta"
          variant="ghost"
          onPress={() => navigation.navigate('Register')}
        />

        <Text style={styles.hint}>Probá con ana@ejemplo.com.py / oppi123</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.lg, justifyContent: 'center', flexGrow: 1 },
  logo: { fontSize: 44, fontWeight: '900', color: colors.primary, marginBottom: 4 },
  subtitle: { fontSize: fontSize.lg, color: colors.muted, marginBottom: spacing.lg },
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
  cta: { marginTop: spacing.lg, marginBottom: spacing.sm },
  hint: { textAlign: 'center', color: colors.muted, fontSize: fontSize.xs, marginTop: spacing.lg },
});
