import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { HandObs, Handedness, P3 } from './types';

/**
 * Crea un HandLandmarker usando el modelo y el WASM empaquetados en
 * `public/models` (nada se pide a la CDN de Google en runtime).
 * `modelsBase` es la URL de la carpeta models (p. ej. "./models").
 */
export async function createHandLandmarker(modelsBase: string, numHands = 2): Promise<HandLandmarker> {
  const base = new URL(modelsBase.replace(/\/?$/, '/'), document.baseURI).href;
  const fileset = await FilesetResolver.forVisionTasks(base + 'wasm');
  const make = (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: base + 'hand_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numHands,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  try {
    return await make('GPU');
  } catch (err) {
    console.warn('GPU no disponible, uso CPU', err);
    return make('CPU');
  }
}

/**
 * Convierte el resultado de MediaPipe a nuestras observaciones. `aspect` =
 * ancho/alto de la imagen analizada: x y z se escalan para que las distancias
 * sean proporcionales a píxeles.
 */
export function toHandObs(res: HandLandmarkerResult, aspect: number): HandObs[] {
  const out: HandObs[] = [];
  for (let i = 0; i < res.landmarks.length; i++) {
    const cat = res.handedness[i]?.[0];
    const lm: P3[] = res.landmarks[i].map((p) => [p.x * aspect, p.y, p.z * aspect]);
    const wl: P3[] = (res.worldLandmarks[i] ?? []).map((p) => [p.x, p.y, p.z]);
    if (lm.length !== 21 || wl.length !== 21) continue;
    out.push({
      label: (cat?.categoryName as Handedness) ?? 'Right',
      score: cat?.score ?? 0,
      lm,
      wl,
    });
  }
  return out;
}
