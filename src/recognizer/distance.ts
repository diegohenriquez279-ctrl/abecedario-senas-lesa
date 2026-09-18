import type { HandFeatures } from '../vision/features';
import { angleBetween, angleDiff, median, medianVec, meanAngle, unit } from '../vision/geometry';
import type { P3 } from '../vision/types';
import type { FeatureGroup, Proto } from './types';

export const GROUPS: FeatureGroup[] = ['shape', 'shape3', 'curl', 'thumb', 'spread', 'axis', 'normal'];

/** Zona muerta de orientación: giros menores a esto no penalizan (cada persona
 * pone la mano un poco distinto). */
const AXIS_DEAD = (25 * Math.PI) / 180;
const NORMAL_DEAD = (25 * Math.PI) / 180;

function rmsPoints(a: number[], b: number[], dim: number): number {
  let s = 0;
  const n = a.length / dim;
  for (let i = 0; i < a.length; i += dim) {
    let d = 0;
    for (let k = 0; k < dim; k++) d += (a[i + k] - b[i + k]) ** 2;
    s += d;
  }
  return Math.sqrt(s / n);
}

function rms(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / a.length);
}

export function toProto(f: HandFeatures | Proto): Proto {
  return {
    shape: f.shape,
    shape3: f.shape3,
    curl: f.curl,
    thumb: f.thumb,
    spread: f.spread,
    axis: f.axis,
    normal: f.normal,
  };
}

/** Distancias crudas por grupo (sin normalizar). */
export function groupDistances(a: Proto, b: Proto): Record<FeatureGroup, number> {
  return {
    shape: rmsPoints(a.shape, b.shape, 2),
    shape3: rmsPoints(a.shape3, b.shape3, 3),
    curl: rms(a.curl, b.curl),
    thumb: rms(a.thumb, b.thumb),
    spread: rms(a.spread, b.spread),
    axis: Math.max(0, angleDiff(a.axis, b.axis) - AXIS_DEAD) / (Math.PI / 2),
    normal: Math.max(0, angleBetween(a.normal, b.normal) - NORMAL_DEAD) / (Math.PI / 2),
  };
}

/** Distancia total ponderada, en "unidades de ruido" (≈1 = variación típica). */
export function protoDistance(
  a: Proto,
  b: Proto,
  scales: Record<FeatureGroup, number>,
  weights: Record<FeatureGroup, number>,
): number {
  const g = groupDistances(a, b);
  let s = 0;
  let wsum = 0;
  for (const k of GROUPS) {
    s += (weights[k] * g[k]) / scales[k];
    wsum += weights[k];
  }
  return s / wsum;
}

/** Prototipo mediano de una lista de rasgos. */
export function medianProto(list: Proto[]): Proto {
  const n = medianVec(list.map((p) => p.normal as number[]));
  return {
    shape: medianVec(list.map((p) => p.shape)),
    shape3: medianVec(list.map((p) => p.shape3)),
    curl: medianVec(list.map((p) => p.curl)),
    thumb: medianVec(list.map((p) => p.thumb)),
    spread: medianVec(list.map((p) => p.spread)),
    axis: meanAngle(list.map((p) => p.axis)),
    normal: unit(n as P3),
  };
}

export { median };
