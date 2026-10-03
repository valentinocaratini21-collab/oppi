import React, { useEffect, useState } from 'react';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, TouchableOpacity, View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../store/AuthContext';
import { colors, spacing } from '../theme';

// Fragmentos de rutas (workers previos): el stack principal las monta acá.
import { clientRoutes } from './clientRoutes';
import { handymanRoutes } from './handymanRoutes';
import { BUSINESS_ROUTES } from './businessRoutes';
import { supportRoutes } from './supportRoutes';

// Auth
import { LoginScreen } from '../screens/auth/LoginScreen';
import { RegisterScreen } from '../screens/auth/RegisterScreen';
import { OnboardingCarouselScreen } from '../screens/OnboardingCarouselScreen';
import { TermsScreen } from '../screens/TermsScreen';
import { PrivacyScreen } from '../screens/PrivacyScreen';

// Tabs
import { HomeScreen } from '../screens/HomeScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { HandymanScreen } from '../screens/HandymanScreen';
import { BookingsScreen } from '../screens/BookingsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
// Tabs por rol (componentes importados directo para las tabs)
import { ConversationsScreen } from '../screens/ConversationsScreen';
import { MyServicesScreen } from '../screens/MyServicesScreen';
import { ProClientsScreen } from '../screens/ProClientsScreen';
import { ProEarningsScreen } from '../screens/ProEarningsScreen';
import { MyBusinessScreen } from '../screens/MyBusinessScreen';
import { BusinessAgendaScreen } from '../screens/BusinessAgendaScreen';
import { BusinessBookingsScreen } from '../screens/BusinessBookingsScreen';
import { HandymanHomeScreen } from '../screens/HandymanHomeScreen';

// Stack (dentro de Main)
import { ProDetailScreen } from '../screens/ProDetailScreen';
import { BookingFlowScreen } from '../screens/BookingFlowScreen';
import { TaskDetailScreen } from '../screens/TaskDetailScreen';
import { PublishTaskScreen } from '../screens/PublishTaskScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { FavoritesScreen } from '../screens/FavoritesScreen';
import { ReferralsScreen } from '../screens/ReferralsScreen';
import { NotificationPrefsScreen } from '../screens/NotificationPrefsScreen';
import { DeleteAccountScreen } from '../screens/DeleteAccountScreen';
import { AdminScreen } from '../screens/AdminScreen';

// Campana
import { NotificationBell } from '../components/NotificationBell';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Inicio: '🏠',
  Buscar: '🔍',
  Reservas: '📅',
  Chats: '✉️',
  Perfil: '👤',
  Agenda: '📅',
  Servicios: '💈',
  Clientes: '👥',
  Ganancias: '💰',
  Panel: '🏪',
  Explorar: '🔍',
  Publicar: '➕',
  Trabajos: '🛠️',
};

/**
 * Tabs estrictas por rol (el usuario tiene UN solo rol: user.role).
 * - Cliente: Inicio, Buscar, Reservas, Chats, Perfil (+ ayuda flotante).
 * - Profesional: Agenda, Servicios, Clientes, Ganancias, Perfil.
 * - Negocio: Panel, Reservas, Agenda, Chats, Perfil.
 * - Handyman: Explorar, Publicar, Trabajos, Chats, Perfil.
 * Sin selector "Ver como": no existen roles múltiples.
 */
function MainTabs() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user } = useAuth();
  const role = user?.role;
  const isPro = role === 'pro';
  const isBusiness = role === 'business';
  const isHandyman = role === 'handyman';
  // Cliente por defecto (incluye admin y roles desconocidos: mundo cliente).
  const isClient = !isPro && !isBusiness && !isHandyman;

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: focused ? 24 : 21 }}>{TAB_ICONS[route.name] || '•'}</Text>
          ),
        })}
      >
        {isClient && (
          <Tab.Screen name="Inicio" component={HomeScreen} />
        )}
        {isClient && (
          <Tab.Screen name="Buscar" component={SearchScreen} />
        )}
        {isBusiness && (
          <Tab.Screen name="Panel" component={MyBusinessScreen} />
        )}
        {isClient && (
          <Tab.Screen name="Reservas" component={BookingsScreen} />
        )}
        {isBusiness && (
          <Tab.Screen name="Reservas" component={BusinessBookingsScreen} />
        )}
        {isPro && (
          <Tab.Screen name="Agenda" component={BookingsScreen} />
        )}
        {isPro && (
          <Tab.Screen name="Servicios" component={MyServicesScreen} />
        )}
        {isPro && (
          <Tab.Screen name="Clientes" component={ProClientsScreen} />
        )}
        {isPro && (
          <Tab.Screen name="Ganancias" component={ProEarningsScreen} />
        )}
        {isBusiness && (
          <Tab.Screen name="Agenda" component={BusinessAgendaScreen} />
        )}
        {isHandyman && (
          <Tab.Screen name="Explorar" component={HandymanScreen} />
        )}
        {isHandyman && (
          <Tab.Screen name="Publicar" component={PublishTaskScreen} />
        )}
        {isHandyman && (
          <Tab.Screen name="Trabajos" component={HandymanHomeScreen} />
        )}
        {(isClient || isBusiness || isHandyman) && (
          <Tab.Screen name="Chats" component={ConversationsScreen} />
        )}
        <Tab.Screen name="Perfil" component={ProfileScreen} />
      </Tab.Navigator>
      {/* Campana de notificaciones: global en las 5 tabs (las tabs no tienen
          header propio; flota sobre el rincón superior derecho de cada una). */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + spacing.sm,
          right: spacing.md,
          zIndex: 10,
        }}
      >
        <NotificationBell />
      </View>
      {/* Botón flotante de ayuda: el soporte vive dentro de la app (chat con
          bot). Va sobre las tabs, abajo a la derecha, con safe-area. */}
      <TouchableOpacity
        onPress={() => navigation.navigate('HelpChat')}
        activeOpacity={0.85}
        accessibilityLabel="Ayuda y soporte"
        style={{
          position: 'absolute',
          right: spacing.md,
          bottom: insets.bottom + 84,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          shadowColor: '#1A1A2E',
          shadowOpacity: 0.25,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 6,
        }}
      >
        <Text style={{ fontSize: 26 }}>💬</Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Stack de auth con gate de onboarding: la primera vez que se abre la app
 * (AsyncStorage 'oppi_onboarding_done' sin setear) se muestra el carrusel
 * de 3 pantallas antes del Login. Después va directo al Login.
 */
function AuthStack() {
  const [checking, setChecking] = useState(true);
  const [initial, setInitial] = useState('Login');

  useEffect(() => {
    (async () => {
      try {
        const done = await AsyncStorage.getItem('oppi_onboarding_done');
        setInitial(done ? 'Login' : 'Onboarding');
      } catch {
        setInitial('Login');
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  if (checking) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <Stack.Navigator initialRouteName={initial} screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Onboarding" component={OnboardingCarouselScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      {/* Términos y privacidad: accesibles desde el registro (checkbox obligatorio). */}
      <Stack.Screen name="Terms" component={TermsScreen} />
      <Stack.Screen name="Privacy" component={PrivacyScreen} />
    </Stack.Navigator>
  );
}

/**
 * Pantalla puente (invisible): primera del MainStack.
 * Decide el destino inicial UNA SOLA VEZ, justo después del registro
 * (consumePendingRole devuelve el rol registrado y lo limpia; en un login
 * normal devuelve null y va a las tabs). No redirige en cada login.
 */
function RoleGate({ navigation }) {
  const { consumePendingRole } = useAuth();

  useEffect(() => {
    const role = consumePendingRole();
    // fromRegistration: el home del rol sabe que vino del registro y manda
    // el "atrás" a MainTabs (no hay nada detrás en el stack).
    if (role === 'business') navigation.replace('BusinessOnboarding', { fromRegistration: true });
    else if (role === 'pro') navigation.replace('MyServices', { fromRegistration: true });
    else if (role === 'handyman') navigation.replace('HandymanHome', { fromRegistration: true });
    else navigation.replace('MainTabs');
    // Se ejecuta una sola vez al montar el stack (login/registro/reinicio con sesión).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

function MainStack() {
  // Guards por rol: cada rol ve solo su mundo. Las rutas con `roles`
  // (ver los fragmentos) solo se registran para esos roles; sin `roles`
  // son públicas dentro de la app. El admin ve todo.
  // Administración: la ruta "Admin" existe solo para usuarios admin; si no,
  // no aparece en la navegación (tampoco en el menú del perfil).
  const { user } = useAuth();
  const role = user?.role;
  const isAdmin = user?.is_admin === true || user?.is_admin === 1 || role === 'admin';
  const canSee = (r) => !r.roles || r.roles.includes(role) || role === 'admin';

  return (
    <Stack.Navigator initialRouteName="RoleGate" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="RoleGate" component={RoleGate} />
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen name="ProDetail" component={ProDetailScreen} />
      <Stack.Screen name="BookingFlow" component={BookingFlowScreen} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} />
      <Stack.Screen name="PublishTask" component={PublishTaskScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="Favorites" component={FavoritesScreen} />
      <Stack.Screen name="Referrals" component={ReferralsScreen} />
      {/* Cuenta: preferencias de notificaciones, eliminar cuenta, legales. */}
      <Stack.Screen name="NotificationPrefs" component={NotificationPrefsScreen} />
      <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} />
      <Stack.Screen name="Terms" component={TermsScreen} />
      <Stack.Screen name="Privacy" component={PrivacyScreen} />
      {/* Admin: solo registrada si el usuario es admin. */}
      {isAdmin && <Stack.Screen name="Admin" component={AdminScreen} />}
      {/* Fragmentos de los workers: cliente, handyman y empresas (con guards por rol) */}
      {clientRoutes.filter(canSee).map((r) => (
        <Stack.Screen key={r.name} name={r.name} component={r.component} />
      ))}
      {handymanRoutes.filter(canSee).map((r) => (
        <Stack.Screen key={r.name} name={r.name} component={r.component} />
      ))}
      {BUSINESS_ROUTES.filter(canSee).map((r) => (
        <Stack.Screen key={r.name} name={r.name} component={r.component} />
      ))}
      {supportRoutes.filter(canSee).map((r) => (
        <Stack.Screen key={r.name} name={r.name} component={r.component} />
      ))}
    </Stack.Navigator>
  );
}

export function RootNavigator() {
  const { isLoggedIn, ready } = useAuth();

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={{ color: colors.muted, marginTop: 12 }}>Cargando Oppi…</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      {isLoggedIn ? <MainStack /> : <AuthStack />}
    </NavigationContainer>
  );
}
