import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  api,
  saveSession,
  clearSession,
  getStoredUser,
  getToken,
  setOnUnauthorized,
} from '../api/client';

const AuthContext = createContext(null);

/**
 * Sesión global: user, token, login/register/logout.
 * Si la API responde 401 en cualquier llamada, el cliente borra la sesión
 * y este contexto desloguea automáticamente (ver setOnUnauthorized).
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  /**
   * Rol recién registrado (one-shot). Lo consume RoleGate (pantalla puente del
   * MainStack) para redirigir SOLO después del registro:
   * business → BusinessOnboarding, pro → MyServices, handyman → HandymanHome.
   * En un login normal vale null → va a MainTabs. No persiste (es memoria),
   * así que al reiniciar la app con sesión guardada siempre va a las tabs.
   */
  const [pendingRole, setPendingRole] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [storedUser, token] = await Promise.all([getStoredUser(), getToken()]);
        if (storedUser && token) {
          // Revalidar contra el backend; si el token murió, limpiamos.
          try {
            const { user: fresh } = await api.me();
            setUser(fresh);
          } catch {
            await clearSession();
            setUser(null);
          }
        }
      } finally {
        setReady(true);
      }
    })();
    setOnUnauthorized(() => setUser(null));
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      isLoggedIn: !!user,
      pendingRole,
      async login(email, password) {
        const { user: u, token } = await api.login(email.trim(), password);
        await saveSession(token, u);
        setUser(u);
        return u;
      },
      async register(payload) {
        const { user: u, token } = await api.register(payload);
        await saveSession(token, u);
        setUser(u);
        // Marca el rol recién registrado para que RoleGate lo redirija
        // a su home correspondiente (se consume una sola vez).
        setPendingRole(u?.role || null);
        return u;
      },
      /** Devuelve y limpia el rol pendiente de redirección (one-shot). */
      consumePendingRole() {
        const role = pendingRole;
        if (role) setPendingRole(null);
        return role;
      },
      async refreshUser() {
        const { user: u } = await api.me();
        const token = await getToken();
        if (token) await saveSession(token, u);
        setUser(u);
        return u;
      },
      /**
       * Editar perfil (PATCH /api/me): guarda en el backend y actualiza la
       * sesión guardada (AsyncStorage) para que la UI se vea al instante.
       * Acepta tanto {user} envuelto como el objeto directo (el contrato
       * muestra el usuario directo; otros endpoints lo envuelven).
       */
      async updateProfile(data) {
        const res = await api.updateMe(data);
        const u = res.user || res;
        const token = await getToken();
        if (token) await saveSession(token, u);
        setUser(u);
        return u;
      },
      async logout() {
        await clearSession();
        setUser(null);
        setPendingRole(null);
      },
    }),
    [user, ready, pendingRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
