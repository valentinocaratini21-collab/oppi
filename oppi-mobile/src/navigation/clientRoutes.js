import { NotificationsScreen } from '../screens/NotificationsScreen';
import { ConversationsScreen } from '../screens/ConversationsScreen';
import { PaymentsScreen } from '../screens/PaymentsScreen';
import { CancellationPolicyScreen } from '../screens/CancellationPolicyScreen';
import { CancelBookingScreen } from '../screens/CancelBookingScreen';
import { ComplianceScreen } from '../screens/ComplianceScreen';
import { ReportNoShowScreen } from '../screens/ReportNoShowScreen';
import { ServiceDetailScreen } from '../screens/ServiceDetailScreen';
import { BookingDetailScreen } from '../screens/BookingDetailScreen';
import { ProClientsScreen } from '../screens/ProClientsScreen';
import { ProStatsScreen } from '../screens/StatsScreens';
import { ClientSummaryScreen } from '../screens/StatsScreens';
import { ClientDetailScreen } from '../screens/ClientDetailScreen';
import { CategoriesScreen } from '../screens/CategoriesScreen';
import { SubcategoriesScreen } from '../screens/SubcategoriesScreen';

/**
 * Rutas del cliente (Bloque 2).
 * El AppNavigator (otro worker) las registra en el stack principal:
 *   clientRoutes.forEach((r) => <Stack.Screen name={r.name} component={r.component} />)
 *
 * `roles` (opcional): si está presente, la ruta solo se registra para esos
 * roles. Sin `roles` la ruta es pública dentro de la app (la ve cualquier
 * rol autenticado). El rol admin ve todo.
 */
export const clientRoutes = [
  { name: 'Notifications', component: NotificationsScreen },
  { name: 'Conversations', component: ConversationsScreen },
  { name: 'Payments', component: PaymentsScreen },
  // Política de cancelación (comodines) — worker móvil 2026-10-01
  { name: 'CancellationPolicy', component: CancellationPolicyScreen },
  { name: 'CancelBooking', component: CancelBookingScreen },
  { name: 'Compliance', component: ComplianceScreen },
  { name: 'ReportNoShow', component: ReportNoShowScreen },
  // Detalle de servicio y de reserva — worker móvil 2026-10-01
  { name: 'ServiceDetail', component: ServiceDetailScreen },
  { name: 'BookingDetail', component: BookingDetailScreen },
  // Clientes y estadísticas del profesional
  { name: 'ProClients', component: ProClientsScreen, roles: ['pro'] },
  { name: 'ProStats', component: ProStatsScreen, roles: ['pro'] },
  // Resumen del cliente (stats MVP) — entrada: Mi perfil
  { name: 'ClientSummary', component: ClientSummaryScreen, roles: ['client'] },
  // Detalle de cliente (compartido pro/negocio)
  { name: 'ClientDetail', component: ClientDetailScreen, roles: ['pro', 'business'] },
  // Taxonomía: categorías → subcategorías
  { name: 'Categories', component: CategoriesScreen },
  { name: 'Subcategories', component: SubcategoriesScreen },
];
