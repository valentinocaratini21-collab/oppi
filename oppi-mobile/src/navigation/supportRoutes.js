import { SupportScreen } from '../screens/SupportScreen';
import { SupportChatScreen } from '../screens/SupportChatScreen';
import { HelpChatScreen } from '../screens/HelpChatScreen';

/**
 * Rutas de soporte (bandeja de agentes de WhatsApp + chat in-app del usuario).
 * El AppNavigator las registra en el stack principal:
 *   supportRoutes.forEach((r) => <Stack.Screen name={r.name} component={r.component} />)
 */
export const supportRoutes = [
  { name: 'Support', component: SupportScreen },
  { name: 'SupportChat', component: SupportChatScreen },
  // Chat de ayuda del usuario (el soporte vive dentro de la app, no en WhatsApp).
  { name: 'HelpChat', component: HelpChatScreen },
];
