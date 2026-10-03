import { useEffect, useState } from 'react';
import { api } from '../api/client';

/**
 * Resuelve el businessId del negocio del usuario.
 * Usa el param si viene (navegación desde el hub MiBusiness); si no,
 * lo busca con GET /api/businesses (las tabs no reciben params).
 * Devuelve { businessId, loadingBiz }.
 */
export function useBusinessId(paramBusinessId) {
  const [businessId, setBusinessId] = useState(paramBusinessId || null);
  const [loadingBiz, setLoadingBiz] = useState(!paramBusinessId);

  useEffect(() => {
    if (paramBusinessId) return;
    let alive = true;
    (async () => {
      try {
        const { businesses } = await api.businesses();
        if (alive && businesses && businesses.length > 0) {
          setBusinessId(businesses[0].id);
        }
      } catch {
        // Sin negocio o sin conexión: la pantalla muestra el vacío amable.
      } finally {
        if (alive) setLoadingBiz(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [paramBusinessId]);

  return { businessId, loadingBiz };
}
