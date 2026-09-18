/** Punto 3D [x, y, z]. */
export type P3 = [number, number, number];

export type Handedness = 'Left' | 'Right';

/**
 * Una mano detectada en un frame, ya lista para procesar.
 * `lm`: landmarks de imagen con x (y z) escalados por el aspecto (W/H), así
 * las distancias son proporcionales a píxeles reales. `wl`: world landmarks
 * de MediaPipe (metros, origen en el centro de la mano, ejes de cámara).
 */
export interface HandObs {
  label: Handedness;
  score: number;
  lm: P3[];
  wl: P3[];
}

/** Un frame con tiempo en segundos y 0..2 manos. */
export interface FrameObs {
  t: number;
  hands: HandObs[];
}
