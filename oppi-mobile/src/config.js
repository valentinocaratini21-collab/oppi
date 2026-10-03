/**
 * Feature flags de la app.
 *
 * FEATURE_MAP: muestra u oculta todo lo relacionado con mapas/ubicación.
 *  - false (default): se ocultan el botón "Ver mapa 🗺️" (handyman), la
 *    entrada a la pantalla de mapa de chambas (el archivo ChambasMapScreen
 *    se conserva intacto, sin entrada visible), el botón
 *    "📍 Usar mi ubicación" (publicar sin coords, como antes) y el botón
 *    "📍 Cerca de mí" (buscar). Nada del código del mapa se borra.
 *  - true: todo vuelve a funcionar como antes.
 */
export const FEATURE_MAP = false;
