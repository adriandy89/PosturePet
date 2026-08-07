/**
 * Prepara vendor/ para que la app funcione 100% offline.
 *
 *  1. Copia el bundle ESM y la carpeta wasm/ de @mediapipe/tasks-vision.
 *     Los .wasm NO se pueden renombrar: FilesetResolver los busca por nombre exacto.
 *  2. Descarga el modelo pose_landmarker_lite.task (~5 MB) de Google.
 *
 * Idempotente: si el archivo ya existe con tamano razonable, no lo vuelve a bajar.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, cp, stat, access } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor');
const PKG = join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision');

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/' +
  'pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const MODEL_DEST = join(VENDOR, 'models', 'pose_landmarker_lite.task');
const MIN_MODEL_BYTES = 1_000_000; // un .task valido pesa ~5 MB; menos = descarga truncada

const exists = (p) => access(p).then(() => true, () => false);

async function copyMediaPipe() {
  if (!(await exists(PKG))) {
    throw new Error(
      'No encuentro @mediapipe/tasks-vision en node_modules.\n' +
        'Ejecuta `npm install` primero.'
    );
  }

  const dest = join(VENDOR, 'tasks-vision');
  await mkdir(dest, { recursive: true });

  // La carpeta wasm/ se copia tal cual: los nombres importan.
  await cp(join(PKG, 'wasm'), join(dest, 'wasm'), { recursive: true });
  await cp(join(PKG, 'vision_bundle.mjs'), join(dest, 'vision_bundle.mjs'));

  console.log('  ok  vendor/tasks-vision/  (bundle ESM + wasm/)');
}

async function fetchModel() {
  if (await exists(MODEL_DEST)) {
    const { size } = await stat(MODEL_DEST);
    if (size > MIN_MODEL_BYTES) {
      console.log(`  ok  modelo ya presente (${(size / 1e6).toFixed(1)} MB)`);
      return;
    }
    console.log('  !   modelo previo truncado, descargando de nuevo');
  }

  await mkdir(dirname(MODEL_DEST), { recursive: true });
  console.log('  ..  descargando pose_landmarker_lite.task');

  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Descarga fallida: HTTP ${res.status} ${res.statusText}`);

  await pipeline(Readable.fromWeb(res.body), createWriteStream(MODEL_DEST));

  const { size } = await stat(MODEL_DEST);
  if (size < MIN_MODEL_BYTES) {
    throw new Error(`Modelo descargado incompleto (${size} bytes). Reintenta.`);
  }
  console.log(`  ok  vendor/models/  (${(size / 1e6).toFixed(1)} MB)`);
}

console.log('Preparando assets locales de MediaPipe...');
await copyMediaPipe();
await fetchModel();
console.log('Listo. La app ya no necesita conexion a internet.');
