import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api/client';
import { colors, fontSize } from '../theme';

/**
 * Campana con badge de no leídas → navega a `Notifications`.
 * Otro worker la monta en el header; este componente solo se encarga
 * de contar las no leídas y navegar.
 */
export function NotificationBell({ navigation: navigationProp }) {
  const navFromHook = useNavigation();
  const navigation = navigationProp || navFromHook;
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try {
      const { notifications } = await api.notifications({ unread: 1 });
      setUnread((notifications || []).length);
    } catch {
      // sin conexión: queda el último conteo
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // polling liviano
    return () => clearInterval(t);
  }, [load]);

  return (
    <TouchableOpacity
      onPress={() => navigation.navigate('Notifications')}
      style={styles.wrap}
      hitSlop={10}
      accessibilityLabel="Notificaciones"
    >
      <Text style={styles.bell}>🔔</Text>
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 4, marginRight: 4 },
  bell: { fontSize: 24 },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: colors.danger,
    borderRadius: 999,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '800' },
});
