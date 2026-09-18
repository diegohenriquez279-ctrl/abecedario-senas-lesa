import type { HandObs, P3 } from './types';
import { angleBetween, cross, dot, norm, sub, unit } from './geometry';

/**
 * Rasgos de una mano, en forma "canónica" (si la mano es la opuesta a la de
 * referencia se espeja en x antes de todo, así una seña hecha con la mano
 * izquierda se compara igual que con la derecha).
 */
export interface HandFeatures {
  /** 20 puntos 2D (sin la muñeca): trasladados a la muñeca, escalados por el
   * tamaño de la mano y rotados para que muñeca→base del medio apunte arriba. */
  shape: number[];
  /** 20 puntos 3D (world landmarks) expresados en el marco de la palma. */
  shape3: number[];
  /** Flexión por dedo [pulgar, índice, medio, anular, meñique]: 0 = extendido, 1 = cerrado. */
  curl: number[];
  /** Distancias de la punta del pulgar a puntos clave, en tamaños de palma. */
  thumb: number[];
  /** Separación entre dedos contiguos [pulgar-índice, índice-medio, medio-anular, anular-meñique]. */
  spread: number[];
  /** Ángulo (rad, imagen, y hacia abajo) de muñeca→base del medio. Arriba = -π/2. */
  axis: number;
  /** Normal de la palma en ejes de cámara (z>0 = hacia adentro de la escena). */
  normal: P3;
  /** 21 puntos 2D trasladados/escalados SIN rotar (para dibujar el hint). */
  disp: number[];
  /** Posición de la muñeca en la imagen (unidades de alto de imagen). */
  wrist: [number, number];
  /** Posición de las puntas del índice y del meñique en la imagen. */
  tips: [number, number, number, number];
  /** Tamaño de la mano en la imagen (unidades de alto de imagen). */
  size: number;
}

export const FINGERS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
] as const;

const THUMB_TARGETS = [5, 9, 13, 17, 6, 10, 8, 12];

function flipX(p: P3): P3 {
  return [-p[0], p[1], p[2]];
}

function palmSize3(pts: P3[]): number {
  return (
    (norm(sub(pts[0], pts[5])) +
      norm(sub(pts[0], pts[17])) +
      norm(sub(pts[5], pts[17])) +
      norm(sub(pts[0], pts[9]))) /
    4
  );
}

function fingerCurl(w: P3[], f: readonly number[], thumb: boolean): number {
  const [a, b, c, d] = f;
  if (thumb) {
    const bend = angleBetween(sub(w[b], w[a]), sub(w[c], w[b])) + angleBetween(sub(w[c], w[b]), sub(w[d], w[c]));
    return Math.min(1.2, bend / 2.2);
  }
  const bend =
    angleBetween(sub(w[a], w[0]), sub(w[b], w[a])) +
    angleBetween(sub(w[b], w[a]), sub(w[c], w[b])) +
    angleBetween(sub(w[c], w[b]), sub(w[d], w[c]));
  return Math.min(1.2, bend / 4.2);
}

/**
 * Calcula los rasgos de una mano. `flip` = espejar en x (mano opuesta a la
 * de referencia). Las coordenadas `lm` ya vienen con x escalado por el aspecto.
 */
export function extractFeatures(hand: HandObs, flip: boolean): HandFeatures {
  const lm = flip ? hand.lm.map(flipX) : hand.lm;
  const wl = flip ? hand.wl.map(flipX) : hand.wl;

  // --- forma 2D, invariante a posición, escala y rotación
  const size = palmSize3(lm) || 1e-6;
  const o = lm[0];
  const ax = [lm[9][0] - o[0], lm[9][1] - o[1]];
  const axis = Math.atan2(ax[1], ax[0]);
  // rotar para que el eje quede en -π/2 (arriba)
  const rot = -Math.PI / 2 - axis;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const shape: number[] = [];
  const disp: number[] = [];
  for (let i = 0; i < 21; i++) {
    const x = (lm[i][0] - o[0]) / size;
    const y = (lm[i][1] - o[1]) / size;
    disp.push(x, y);
    if (i > 0) shape.push(x * cr - y * sr, x * sr + y * cr);
  }

  // --- forma 3D en el marco de la palma (world landmarks)
  const ws = palmSize3(wl) || 1e-6;
  const yA = unit(sub(wl[9], wl[0]));
  const across = sub(wl[5], wl[17]);
  const zA = unit(cross(across, yA));
  const xA = cross(yA, zA);
  const shape3: number[] = [];
  for (let i = 1; i < 21; i++) {
    const v = sub(wl[i], wl[0]);
    shape3.push(dot(v, xA) / ws, dot(v, yA) / ws, dot(v, zA) / ws);
  }

  const curl = FINGERS.map((f, i) => fingerCurl(wl, f, i === 0));
  const thumb = THUMB_TARGETS.map((j) => norm(sub(wl[4], wl[j])) / ws);
  const spread = [
    angleBetween(sub(wl[4], wl[2]), sub(wl[6], wl[5])),
    angleBetween(sub(wl[6], wl[5]), sub(wl[10], wl[9])),
    angleBetween(sub(wl[10], wl[9]), sub(wl[14], wl[13])),
    angleBetween(sub(wl[14], wl[13]), sub(wl[18], wl[17])),
  ].map((a) => a / (Math.PI / 2));
  const normal = unit(cross(sub(wl[5], wl[0]), sub(wl[17], wl[0])));

  return {
    shape,
    shape3,
    curl,
    thumb,
    spread,
    axis,
    normal,
    disp,
    wrist: [lm[0][0], lm[0][1]],
    tips: [lm[8][0], lm[8][1], lm[20][0], lm[20][1]],
    size,
  };
}
