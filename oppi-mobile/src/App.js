import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './store/AuthContext';
import { RootNavigator } from './navigation/AppNavigator';

/**
 * Oppi — app móvil (Expo, managed workflow).
 * Consume el backend REAL: ~/workspace/oppi-api (ver src/api/client.js).
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
