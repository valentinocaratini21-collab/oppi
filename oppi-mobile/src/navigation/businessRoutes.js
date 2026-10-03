/**
 * Rutas de Oppi Empresas para el mobile.
 *
 * Nombres canónicos (no cambiar): BusinessOnboarding, MyBusiness,
 * BusinessProfile, MyServices + las internas del hub.
 *
 * Para registrarlas en el navegador (AppNavigator.js):
 *
 *   import { BUSINESS_ROUTES } from './businessRoutes';
 *   ...
 *   {BUSINESS_ROUTES.map((r) => (
 *     <Stack.Screen key={r.name} name={r.name} component={r.component} />
 *   ))}
 */
import { BusinessOnboardingScreen } from '../screens/BusinessOnboardingScreen';
import { MyBusinessScreen } from '../screens/MyBusinessScreen';
import { BusinessProfileScreen } from '../screens/BusinessProfileScreen';
import { MyServicesScreen } from '../screens/MyServicesScreen';
import { BusinessAgendaScreen } from '../screens/BusinessAgendaScreen';
import { BusinessBookingsScreen } from '../screens/BusinessBookingsScreen';
import { BusinessServicesScreen } from '../screens/BusinessServicesScreen';
import { BusinessTeamScreen } from '../screens/BusinessTeamScreen';
import { BusinessReviewsScreen } from '../screens/BusinessReviewsScreen';
import { BusinessDocumentsScreen } from '../screens/BusinessDocumentsScreen';
import { BusinessNotificationsScreen } from '../screens/BusinessNotificationsScreen';
import { BusinessCouponsScreen } from '../screens/BusinessCouponsScreen';
import { ProEarningsScreen } from '../screens/ProEarningsScreen';
import { BusinessCancellationHistoryScreen } from '../screens/BusinessCancellationHistoryScreen';
import { BusinessBranchesScreen } from '../screens/BusinessBranchesScreen';
import { BusinessClientsScreen } from '../screens/BusinessClientsScreen';
import { BusinessStatsScreen } from '../screens/StatsScreens';

/** Nombres canónicos de ruta. */
export const BUSINESS_ROUTE_NAMES = {
  ONBOARDING: 'BusinessOnboarding',
  MY_BUSINESS: 'MyBusiness',
  PROFILE: 'BusinessProfile',
  MY_SERVICES: 'MyServices',
  AGENDA: 'BusinessAgenda',
  BOOKINGS: 'BusinessBookings',
  SERVICES: 'BusinessServices',
  TEAM: 'BusinessTeam',
  REVIEWS: 'BusinessReviews',
  DOCUMENTS: 'BusinessDocuments',
  NOTIFICATIONS: 'BusinessNotifications',
  COUPONS: 'BusinessCoupons',
  PRO_EARNINGS: 'ProEarnings',
  CANCELLATION_HISTORY: 'BusinessCancellationHistory',
  BRANCHES: 'BusinessBranches',
  CLIENTS: 'BusinessClients',
  STATS: 'BusinessStats',
};

/** Lista lista para mapear a <Stack.Screen name component />.
 * `roles` restringe la registración por rol (sin `roles` = pública en la app).
 * BusinessProfile es pública (los clientes ven el perfil del negocio);
 * MyServices y ProEarnings son del profesional aunque vivan en este archivo. */
export const BUSINESS_ROUTES = [
  { name: 'BusinessOnboarding', component: BusinessOnboardingScreen, roles: ['business'] },
  { name: 'MyBusiness', component: MyBusinessScreen, roles: ['business'] },
  { name: 'BusinessProfile', component: BusinessProfileScreen },
  { name: 'MyServices', component: MyServicesScreen, roles: ['pro'] },
  { name: 'BusinessAgenda', component: BusinessAgendaScreen, roles: ['business'] },
  { name: 'BusinessBookings', component: BusinessBookingsScreen, roles: ['business'] },
  { name: 'BusinessServices', component: BusinessServicesScreen, roles: ['business'] },
  { name: 'BusinessTeam', component: BusinessTeamScreen, roles: ['business'] },
  { name: 'BusinessReviews', component: BusinessReviewsScreen, roles: ['business'] },
  { name: 'BusinessDocuments', component: BusinessDocumentsScreen, roles: ['business'] },
  { name: 'BusinessNotifications', component: BusinessNotificationsScreen, roles: ['business'] },
  { name: 'BusinessCoupons', component: BusinessCouponsScreen, roles: ['business'] },
  { name: 'ProEarnings', component: ProEarningsScreen, roles: ['pro'] },
  { name: 'BusinessCancellationHistory', component: BusinessCancellationHistoryScreen, roles: ['business'] },
  // Sucursales, clientes y reportes del negocio — worker móvil 2026-10-01
  { name: 'BusinessBranches', component: BusinessBranchesScreen, roles: ['business'] },
  { name: 'BusinessClients', component: BusinessClientsScreen, roles: ['business'] },
  { name: 'BusinessStats', component: BusinessStatsScreen, roles: ['business'] },
];

export default BUSINESS_ROUTES;
