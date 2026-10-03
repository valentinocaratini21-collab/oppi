import { HandymanHomeScreen } from '../screens/HandymanHomeScreen';
import { JobDetailScreen } from '../screens/JobDetailScreen';
import { ChambasMapScreen } from '../screens/ChambasMapScreen';

/**
 * Rutas del flujo handyman. Para registrarlas en el stack principal:
 *
 *   import { handymanRoutes } from './navigation/handymanRoutes';
 *   {handymanRoutes.map((r) => (
 *     <Stack.Screen key={r.name} name={r.name} component={r.component} />
 *   ))}
 *
 * `roles`: HandymanHome y ChambasMap son solo del handyman; JobDetail lo
 * ven cliente y handyman (son las dos partes del trabajo).
 */
export const handymanRoutes = [
  { name: 'HandymanHome', component: HandymanHomeScreen, roles: ['handyman'] },
  { name: 'JobDetail', component: JobDetailScreen },
  { name: 'ChambasMap', component: ChambasMapScreen, roles: ['handyman'] },
];
