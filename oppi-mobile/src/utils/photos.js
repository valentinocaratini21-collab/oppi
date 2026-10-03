/**
 * Fotos: elegir desde la galería y subir al backend (POST /api/uploads).
 *
 * El backend acepta JSON { filename, data_url } (data:image/jpeg;base64,...),
 * así que pedimos el base64 al picker y lo mandamos directo por `api.upload`.
 *
 * Retorno de pickAndUpload():
 *   { canceled: true }                       → el usuario cerró el picker
 *   { canceled: false, file: { url, key, ... } } → foto subida, lista para
 *                                                   guardar en photos[] (tarea/mensaje)
 *
 * Lanza Error con mensaje en español en: permiso denegado, foto muy pesada
 * (>5 MB, límite del backend) o falla de red/subida.
 */
import * as ImagePicker from 'expo-image-picker';
import { api, ApiError } from '../api/client.js';

const MAX_BYTES = 5 * 1024 * 1024;

function friendlyError(err) {
  if (err instanceof ApiError) return err.message;
  if (err?.message === 'Network request failed') {
    return 'Sin conexión. Revisá tu internet e intentá de nuevo.';
  }
  return 'No pudimos subir la foto. Probá de nuevo en un rato.';
}

/**
 * Abre la galería, deja elegir una foto y la sube.
 * options: { allowsEditing?: boolean, quality?: number (0-1) }
 */
export async function pickAndUpload(options = {}) {
  const { allowsEditing = false, quality = 0.8 } = options;

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      'Necesitamos acceso a tus fotos para subirla. Activá el permiso en Ajustes e intentá de nuevo.'
    );
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing,
    quality,
    base64: true,
  });

  if (result.canceled) return { canceled: true };

  const asset = result.assets?.[0];
  if (!asset?.base64) {
    throw new Error('No pudimos leer la foto elegida. Probá con otra.');
  }

  const sizeBytes = asset.fileSize || Math.floor((asset.base64.length * 3) / 4);
  if (sizeBytes > MAX_BYTES) {
    throw new Error('La foto es muy pesada (máximo 5 MB). Elegí una más liviana.');
  }

  const mime = asset.mimeType || 'image/jpeg';
  const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const filename = asset.fileName || `foto.${ext}`;

  try {
    const { file } = await api.upload({
      filename,
      data_url: `data:${mime};base64,${asset.base64}`,
    });
    return { canceled: false, file };
  } catch (err) {
    throw new Error(friendlyError(err));
  }
}
