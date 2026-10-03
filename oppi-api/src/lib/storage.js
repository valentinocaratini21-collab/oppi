'use strict';

/**
 * Storage — interfaz de guardado de archivos + drivers.
 *
 * Driver elegido por env `STORAGE_DRIVER` (default: `local`):
 *  - local → LocalDriver: guarda en disco (STORAGE_LOCAL_DIR, default
 *    `data/uploads/`) y se sirve por Express en `/uploads/*`.
 *  - s3    → S3Driver: esqueleto compatible S3 (sirve para AWS S3, Cloudflare
 *    R2 o MinIO). Requiere STORAGE_S3_* (TODO abajo).
 *
 * Interfaz (StorageProvider):
 *  - save(buffer, { filename, contentType }) → { url, key }
 *      `url` es pública (para guardar en photos[] de tareas/mensajes);
 *      `key` es el identificador interno (para borrar).
 *  - delete(key) → void
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

class StorageProvider {
  constructor() {
    if (new.target === StorageProvider) throw new Error('StorageProvider es una interfaz: usá un driver concreto.');
    this.name = 'base';
  }
  async save(/* buffer, { filename, contentType } */) { throw new Error('no implementado'); }
  async delete(/* key */) { throw new Error('no implementado'); }
}

/** Directorio local de uploads (se crea si no existe). */
function getUploadsDir() {
  const dir = path.resolve(process.env.STORAGE_LOCAL_DIR || path.join('data', 'uploads'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const EXT_BY_TYPE = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
};

class LocalDriver extends StorageProvider {
  constructor(dir) {
    super();
    this.name = 'local';
    this.dir = dir || getUploadsDir();
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /** Guarda el buffer con nombre aleatorio (nunca se usa el nombre del usuario en disco). */
  async save(buffer, { filename, contentType } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Nada para guardar: buffer vacío.');
    const ext = EXT_BY_TYPE[contentType] || path.extname(String(filename || '')).toLowerCase().slice(0, 5) || '.bin';
    const key = `${crypto.randomBytes(16).toString('hex')}${ext}`;
    await fs.promises.writeFile(path.join(this.dir, key), buffer);
    return { url: `/uploads/${key}`, key };
  }

  async delete(key) {
    const safe = path.basename(String(key));
    try { await fs.promises.unlink(path.join(this.dir, safe)); } catch { /* ya no estaba */ }
  }
}

/**
 * S3Driver — ESQUELETO compatible S3 (AWS S3, Cloudflare R2, MinIO).
 *
 * TODO(s3): implementarlo cuando haya un bucket. Pasos concretos:
 *  1. Crear el bucket (privado con lectura pública, o con CDN por delante) y
 *     generar credenciales de acceso. Setear:
 *       STORAGE_DRIVER=local  →  STORAGE_DRIVER=s3
 *       STORAGE_S3_ENDPOINT  → ej. https://s3.amazonaws.com (AWS),
 *                               https://<account>.r2.cloudflarestorage.com (R2),
 *                               http://minio:9000 (MinIO propio)
 *       STORAGE_S3_BUCKET    → nombre del bucket (ej. oppi-uploads)
 *       STORAGE_S3_REGION    → ej. us-east-1 (en R2 se ignora pero va igual)
 *       STORAGE_S3_KEY       → access key id
 *       STORAGE_S3_SECRET    → secret access key (nunca commitearla ni loguearla)
 *       STORAGE_S3_PUBLIC_URL→ (opcional) base pública, ej. https://cdn.oppi.com
 *  2. Implementar save(): PUT Object a
 *     `{ENDPOINT}/{BUCKET}/{key}` con firma SigV4 (se puede hacer con
 *     node:crypto, o sumar la dependencia `@aws-sdk/client-s3` y usar
 *     PutObjectCommand — recomendado).
 *  3. La `url` devuelta debe ser `{PUBLIC_URL || ENDPOINT/BUCKET}/{key}`.
 *  4. Si las fotos son privadas: en vez de URL pública, firmar URLs
 *     temporales (GetObject presigned, expiración corta).
 *
 *  Mientras tanto, save()/delete() lanzan un error explícito.
 */
class S3Driver extends StorageProvider {
  constructor() {
    super();
    this.name = 's3';
    const cfg = {
      endpoint: process.env.STORAGE_S3_ENDPOINT,
      bucket: process.env.STORAGE_S3_BUCKET,
      region: process.env.STORAGE_S3_REGION,
      key: process.env.STORAGE_S3_KEY,
      secret: process.env.STORAGE_S3_SECRET,
      publicUrl: process.env.STORAGE_S3_PUBLIC_URL,
    };
    const missing = ['STORAGE_S3_ENDPOINT', 'STORAGE_S3_BUCKET', 'STORAGE_S3_REGION', 'STORAGE_S3_KEY', 'STORAGE_S3_SECRET']
      .filter((k) => !process.env[k]);
    if (missing.length) {
      throw new Error(`Storage S3 sin configurar: faltan ${missing.join(', ')}.`);
    }
    this.cfg = cfg;
  }

  async save() {
    throw new Error('TODO(s3): implementar PUT Object con SigV4 (o @aws-sdk/client-s3). Ver el bloque TODO en src/lib/storage.js.');
  }

  async delete() {
    throw new Error('TODO(s3): implementar DeleteObject. Ver el bloque TODO en src/lib/storage.js.');
  }
}

const DRIVERS = { local: LocalDriver, s3: S3Driver };
let cached = null;
let cachedName = null;

/** Devuelve el driver según STORAGE_DRIVER (default: local). */
function getStorageProvider() {
  const name = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
  const Driver = DRIVERS[name];
  if (!Driver) throw new Error(`STORAGE_DRIVER desconocido: "${name}" (usá ${Object.keys(DRIVERS).join(' | ')}).`);
  if (!cached || cachedName !== name) {
    cached = new Driver();
    cachedName = name;
  }
  return cached;
}

module.exports = { StorageProvider, LocalDriver, S3Driver, getStorageProvider, getUploadsDir, EXT_BY_TYPE };
