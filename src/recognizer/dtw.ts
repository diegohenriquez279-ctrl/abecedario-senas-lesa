import type { HandFeatures } from '../vision/features';
import type { DynTemplate, Proto } from './types';

/** Toma `n` frames equiespaciados en el tiempo (el más cercano a cada instante). */
export function resampleWindow(frames: { t: number; f: HandFeatures }[], n: number): HandFeatures[] {
  const t0 = frames[0].t;
  const t1 = frames[frames.length - 1].t;
  const out: HandFeatures[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / (n - 1);
    while (j < frames.length - 1 && Math.abs(frames[j + 1].t - t) <= Math.abs(frames[j].t - t)) j++;
    out.push(frames[j].f);
  }
  return out;
}

function keyPos(f: HandFeatures, key: 0 | 8 | 20): [number, number] {
  if (key === 8) return [f.tips[0], f.tips[1]];
  if (key === 20) return [f.tips[2], f.tips[3]];
  return f.wrist;
}

/** Máxima corrección de inclinación que se aplica a la trayectoria. */
const MAX_TILT = (35 * Math.PI) / 180;

/**
 * Trayectoria del punto clave relativa al primer frame, en tamaños de mano.
 * Se gira según la inclinación inicial de la mano (acotada a ±35°): si la
 * persona tiene la mano algo inclinada, el trazo también lo está.
 */
export function trajectoryOf(seq: HandFeatures[], key: 0 | 8 | 20): [number, number][] {
  const size = seq.reduce((s, f) => s + f.size, 0) / seq.length || 1;
  const [x0, y0] = keyPos(seq[0], key);
  let tilt = -Math.PI / 2 - seq[0].axis;
  tilt = Math.atan2(Math.sin(tilt), Math.cos(tilt));
  tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, tilt));
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  return seq.map((f) => {
    const [x, y] = keyPos(f, key);
    const dx = (x - x0) / size;
    const dy = (y - y0) / size;
    return [dx * c - dy * s, dx * s + dy * c];
  });
}

export function extentOf(traj: [number, number][]): number {
  let e = 0;
  for (const [x, y] of traj) e = Math.max(e, Math.hypot(x, y));
  // incluye también el ancho del recorrido (un movimiento de ida y vuelta vuelve al origen)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of traj) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return Math.max(e, Math.hypot(maxX - minX, maxY - minY));
}

export const DTW_TRAJ_WEIGHT = 1;
export const DTW_SHAPE_WEIGHT = 0.6;
/** Peso del error de punto final (dónde termina el trazo): distingue la
 * dirección del movimiento (p. ej. RR hacia el costado vs. bajar la mano). */
export const DTW_END_WEIGHT = 0.6;
/** El trazo del usuario tiene que medir entre estas fracciones de la plantilla. */
export const MIN_EXTENT_RATIO = 0.5;
export const MAX_EXTENT_RATIO = 3;
/** Factores de duración (respecto de la plantilla) que se prueban para la ventana. */
const WINDOW_FACTORS = [0.6, 0.8, 1, 1.25, 1.6, 2];

export interface DynMatch {
  cost: number;
  extentRatio: number;
  shapeCost: number;
  trajCost: number;
  endErr: number;
  /** la mano terminó quieta/visible y en la forma final de la plantilla */
  endOk: boolean;
  seq: HandFeatures[];
}

/**
 * Busca la mejor coincidencia de la plantilla con ventanas que terminan en
 * `now`. `frames` = frames recientes (f = null si no se detectó mano).
 * Compartido por el juego y por la calibración del extractor.
 */
export function bestDynamicMatch(
  frames: { t: number; f: HandFeatures | null }[],
  now: number,
  tpl: DynTemplate,
  shapeDist: (a: Proto, b: Proto) => number,
  opts: { maxWindow: number; minCoverage: number },
): DynMatch | null {
  // cierre: en los últimos 0,25 s la mano sigue visible y en la forma final
  const tail = frames.filter((x) => x.t > now - 0.25 && x.t <= now);
  const tailHands = tail.filter((x) => x.f);
  const last = tpl.frames[tpl.frames.length - 1].p;
  const endOk =
    tailHands.length >= 2 &&
    tailHands.length >= tail.length * 0.6 &&
    tailHands.reduce((s, x) => s + shapeDist(x.f!, last), 0) / tailHands.length < 1.3;

  let best: DynMatch | null = null;
  for (const k of WINDOW_FACTORS) {
    const L = Math.min(opts.maxWindow, Math.max(0.4, tpl.duration * k));
    const all = frames.filter((x) => x.t > now - L && x.t <= now);
    if (!all.length || all[0].t > now - L * 0.85) continue; // no cubre la ventana
    const win = all.filter((x) => x.f) as { t: number; f: HandFeatures }[];
    if (win.length < 6 || win.length / all.length < opts.minCoverage) continue;
    const seq = resampleWindow(win, tpl.frames.length);
    const traj = trajectoryOf(seq, tpl.keyPoint);
    const r = dtwCost(seq, traj, tpl, shapeDist);
    if (!best || r.cost < best.cost) best = { ...r, endOk, seq };
  }
  return best;
}

/** ¿La coincidencia cuenta como la letra dinámica? */
export function dynamicAccepted(m: DynMatch, threshold: number): boolean {
  return m.cost < threshold && m.endOk && m.extentRatio >= MIN_EXTENT_RATIO && m.extentRatio <= MAX_EXTENT_RATIO;
}

/**
 * DTW entre la secuencia del usuario y la plantilla. El costo local combina la
 * forma de la mano (distancia normalizada por el umbral de la letra) y la
 * posición del punto clave (normalizada por la extensión de la plantilla).
 */
export function dtwCost(
  seq: HandFeatures[],
  traj: [number, number][],
  tpl: DynTemplate,
  shapeDist: (a: Proto, b: Proto) => number,
): { cost: number; extentRatio: number; shapeCost: number; trajCost: number; endErr: number } {
  const n = seq.length;
  const m = tpl.frames.length;
  const userExtent = extentOf(traj);
  const extentRatio = userExtent / Math.max(1e-6, tpl.extent);
  // tolerancia de tamaño: se reescala el trazo del usuario (acotado)
  const s = Math.min(1.6, Math.max(0.6, 1 / Math.max(1e-6, extentRatio)));
  const norm = Math.max(0.3, tpl.extent);

  const sc: number[][] = [];
  const tc: number[][] = [];
  for (let i = 0; i < n; i++) {
    sc.push([]);
    tc.push([]);
    for (let j = 0; j < m; j++) {
      sc[i].push(shapeDist(seq[i], tpl.frames[j].p));
      const [tx, ty] = tpl.frames[j].tr;
      tc[i].push(Math.hypot(traj[i][0] * s - tx, traj[i][1] * s - ty) / norm);
    }
  }
  const INF = Infinity;
  const D: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  const P: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  D[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const c = DTW_TRAJ_WEIGHT * tc[i - 1][j - 1] + DTW_SHAPE_WEIGHT * sc[i - 1][j - 1];
      let best = D[i - 1][j - 1];
      let from = 0;
      if (D[i - 1][j] < best) {
        best = D[i - 1][j];
        from = 1;
      }
      if (D[i][j - 1] < best) {
        best = D[i][j - 1];
        from = 2;
      }
      D[i][j] = c + best;
      P[i][j] = from;
    }
  }
  // recorrer el camino para separar costo de forma y de trayectoria
  let i = n;
  let j = m;
  let len = 0;
  let sSum = 0;
  let tSum = 0;
  while (i > 0 && j > 0) {
    sSum += sc[i - 1][j - 1];
    tSum += tc[i - 1][j - 1];
    len++;
    const from = P[i][j];
    if (from === 0) {
      i--;
      j--;
    } else if (from === 1) i--;
    else j--;
  }
  const [ex, ey] = tpl.frames[m - 1].tr;
  const endErr = Math.hypot(traj[n - 1][0] * s - ex, traj[n - 1][1] * s - ey) / norm;
  return {
    cost: D[n][m] / len + DTW_END_WEIGHT * endErr,
    extentRatio,
    shapeCost: sSum / len,
    trajCost: tSum / len,
    endErr,
  };
}
