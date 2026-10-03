import React from 'react';
import { api } from '../api/client';
import { ClientsList } from './ClientsList';

/**
 * "Clientes" del PROFESIONAL (ruta "ProClients").
 * GET /api/pro/clients → buscador + lista → detalle con historial.
 */
export function ProClientsScreen({ navigation }) {
  return (
    <ClientsList
      title="Mis clientes"
      onBack={() => navigation.goBack()}
      navigation={navigation}
      loadClients={async () => {
        const data = await api.proClients();
        return data.clients || data;
      }}
    />
  );
}
