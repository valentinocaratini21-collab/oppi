'use strict';

const { createApp } = require('./app');

// Valida la configuración al arrancar (falla rápido si falta una variable).
require('./lib/config').validateOrExit();

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || './data/oppi.db';

async function main() {
  const { app } = await createApp({ dbPath: DB_PATH });
  app.listen(PORT, () => {
    const driver = process.env.DATABASE_URL ? `postgres (${maskDbUrl(process.env.DATABASE_URL)})` : `sqlite (${DB_PATH})`;
    console.log(`Oppi API escuchando en http://localhost:${PORT} (DB: ${driver})`);
  });
}

function maskDbUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch { return '(url inválida)'; }
}

main().catch((err) => {
  console.error('[oppi-api] no se pudo levantar:', err.message);
  process.exit(1);
});
