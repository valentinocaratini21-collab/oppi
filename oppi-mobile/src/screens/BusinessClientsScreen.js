import React from 'react';
import { api } from '../api/client';
import { ClientsList } from './ClientsList';

/**
 * "Clientes" del NEGOCIO (ruta "BusinessClients", params {businessId}).
 * GET /api/businesses/:id/clients → buscador + lista → detalle con historial.
 */
export function BusinessClientsScreen({ navigation, route }) {
  const { businessId } = route.params || {};
  return (
    <ClientsList
      title="Clientes"
      onBack={() => navigation.goBack()}
      navigation={navigation}
      loadClients={async () => {
        const data = await api.businessClients(businessId);
        return data.clients || data;
      }}
    />
  );
}
