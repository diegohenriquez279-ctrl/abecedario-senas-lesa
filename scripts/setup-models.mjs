// Prepara public/models: copia el WASM de MediaPipe desde node_modules y
// descarga (una sola vez) el modelo hand_landmarker.task. En runtime el juego
// sirve todo localmente y no depende de la CDN de Google.
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'models');
const wasmDir = join(outDir, 'wasm');
mkdirSync(wasmDir, { recursive: true });

const srcWasm = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
for (const f of [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]) {
  copyFileSync(join(srcWasm, f), join(wasmDir, f));
  console.log('copiado', f);
}

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const modelPath = join(outDir, 'hand_landmarker.task');
if (existsSync(modelPath) && statSync(modelPath).size > 1_000_000) {
  console.log('modelo ya presente');
} else {
  console.log('descargando modelo…');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Descarga falló: ${res.status}`);
  writeFileSync(modelPath, Buffer.from(await res.arrayBuffer()));
  console.log('modelo guardado', statSync(modelPath).size, 'bytes');
}
