import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Referidos: mi código (para compartir), usos, y canjear el código de un amigo
 * (+Gs. 20.000 de crédito). Probá con el código OPPI-AMIGO.
 */
export function ReferralsScreen({ navigation }) {
  const { refreshUser } = useAuth();
  const [referrals, setReferrals] = useState([]);
  const [bonus, setBonus] = useState(0);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [redeeming, setRedeeming] = useState(false);

  const load = useCallback(async () => {
    try {
      const { referrals: r, bonus_gs } = await api.referrals();
      setReferrals(r);
      setBonus(bonus_gs);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos cargar tus referidos.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function redeem() {
    if (!code.trim()) {
      Alert.alert('Falta el código', 'Pasame el código de tu amigo.');
      return;
    }
    setRedeeming(true);
    try {
      const { message } = await api.redeemReferral(code.trim());
      Alert.alert('¡Bien ahí!', message || `Sumaste ${gs(bonus)} de crédito.`);
      setCode('');
      await refreshUser();
    } catch (e) {
      Alert.alert('No se pudo canjear', e.message || 'Revisá el código e intentá de nuevo.');
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Referidos 🎁" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : (
          <>
            <Card>
              <Text style={styles.section}>Tu código</Text>
              <Text style={styles.sub}>
                Compartilo con amigos: cuando lo canjeen, ellos suman {gs(bonus)} de crédito.
              </Text>
              {referrals.map((r) => (
                <View key={r.code} style={styles.codeBox}>
                  <Text style={styles.code}>{r.code}</Text>
                  <Text style={styles.codeHint}>Pasalo tal cual a tus amigos</Text>
                </View>
              ))}
              {referrals.map((r) => (
                <Text key={`u-${r.code}`} style={styles.uses}>
                  Usos: {r.uses}/{r.max_uses}
                </Text>
              ))}
            </Card>

            <Card>
              <Text style={styles.section}>¿Tenés el código de un amigo?</Text>
              <Text style={styles.sub}>Canjealo y sumá {gs(bonus)} de crédito al instante.</Text>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase())}
                placeholder="Ej. OPPI-AMIGO"
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
              />
              <PrimaryButton title="Canjear código" onPress={redeem} loading={redeeming} style={{ marginTop: spacing.md }} />
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },
  section: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginBottom: 6 },
  sub: { fontSize: fontSize.sm, color: colors.muted, marginBottom: spacing.md, lineHeight: 20 },
  codeBox: {
    backgroundColor: colors.light, borderRadius: radius.button, padding: 14,
    alignItems: 'center',
  },
  code: { fontSize: fontSize.lg, fontWeight: '900', color: colors.primary, letterSpacing: 1 },
  codeHint: { fontSize: fontSize.xs, color: colors.muted, marginTop: 4 },
  uses: { fontSize: fontSize.sm, color: colors.muted, marginTop: 6 },
  input: {
    backgroundColor: colors.bg, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, fontSize: fontSize.lg, fontWeight: '700',
    color: colors.text, letterSpacing: 1,
  },
});
