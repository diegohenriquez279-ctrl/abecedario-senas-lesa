import type { P3 } from './types';

export const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: P3, s: number): P3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: P3, b: P3): P3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: P3) => Math.hypot(a[0], a[1], a[2]);
export const norm2 = (a: P3) => Math.hypot(a[0], a[1]);
export const unit = (a: P3): P3 => {
  const n = norm(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
/** Ángulo (rad) entre dos vectores 3D. */
export const angleBetween = (a: P3, b: P3) => {
  const c = dot(a, b) / ((norm(a) || 1) * (norm(b) || 1));
  return Math.acos(Math.max(-1, Math.min(1, c)));
};
/** Diferencia angular mínima (rad) entre dos ángulos, en [0, π]. */
export const angleDiff = (a: number, b: number) => {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
};

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Mediana componente a componente de una lista de vectores. */
export function medianVec(vs: number[][]): number[] {
  if (!vs.length) return [];
  return vs[0].map((_, i) => median(vs.map((v) => v[i])));
}

/** Mediana circular aproximada de ángulos (vía media de vectores unitarios). */
export function meanAngle(as: number[]): number {
  let c = 0;
  let s = 0;
  for (const a of as) {
    c += Math.cos(a);
    s += Math.sin(a);
  }
  return Math.atan2(s, c);
}
