import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { Card } from '../components/Card';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Eliminar cuenta (ruta "DeleteAccount").
 * Mi perfil → zona de peligro "Eliminar mi cuenta".
 * Doble confirmación con explicación de la anonimización → pide la
 * contraseña → DELETE /api/me {password} → logout.
 */
export function DeleteAccountScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const [step, setStep] = useState(1);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  function confirmFirst() {
    Alert.alert(
      '¿Seguro que querés eliminar tu cuenta?',
      'Esto no se puede deshacer. Si querés seguir, te vamos a pedir tu contraseña para confirmar.',
      [
        { text: 'Mejor no', style: 'cancel' },
        { text: 'Sí, continuar', style: 'destructive', onPress: () => setStep(2) },
      ]
    );
  }

  async function doDelete() {
    if (!password) {
      Alert.alert('Falta tu contraseña', 'Escribila para confirmar que sos vos.');
      return;
    }
    Alert.alert(
      'Última confirmación',
      'Tu cuenta y tus datos personales se eliminan para siempre. ¿Seguís?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar definitivamente',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await api.deleteAccount(password);
              Alert.alert('Cuenta eliminada', 'Te vamos a extrañar. ¡Gracias por haber usado Oppi!', [
                { text: 'Cerrar', onPress: () => logout() },
              ]);
            } catch (e) {
              Alert.alert(
                'No pudimos eliminar tu cuenta',
                e.message || 'Revisá tu contraseña e intentá de nuevo.'
              );
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="Eliminar mi cuenta" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Card style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>⚠️ Zona de peligro</Text>
          <Text style={styles.dangerText}>
            Al eliminar tu cuenta:
            {'\n\n'}• Tus datos personales (nombre, email, teléfono, foto) se{' '}
            <Text style={styles.bold}>anonimizan</Text>: ya no quedan vinculados a vos.
            {'\n'}• Perdés el acceso a tu cuenta, tus reservas, tus chats y tu crédito.
            {'\n'}• Tus reseñas y reservas pasadas pueden conservarse de forma anónima por
            obligaciones legales.
            {'\n'}• <Text style={styles.bold}>No se puede deshacer.</Text>
          </Text>
        </Card>

        {step === 1 ? (
          <PrimaryButton
            title="Quiero eliminar mi cuenta"
            variant="danger"
            onPress={confirmFirst}
            style={styles.cta}
          />
        ) : (
          <>
            <Text style={styles.label}>Tu contraseña (para confirmar que sos vos)</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••"
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoCapitalize="none"
            />
            <PrimaryButton
              title="Eliminar definitivamente"
              variant="danger"
              onPress={doDelete}
              loading={deleting}
              disabled={deleting}
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
  inner: { padding: spacing.md },
  dangerCard: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: '#F5C6C6' },
  dangerTitle: { fontSize: fontSize.md, fontWeight: '800', color: colors.danger, marginBottom: spacing.sm },
  dangerText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 22 },
  bold: { fontWeight: '800' },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    fontSize: fontSize.md,
    color: colors.text,
  },
  cta: { marginTop: spacing.lg },
});
