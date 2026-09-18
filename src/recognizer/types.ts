import type { P3 } from '../vision/types';

/** Rasgos que describen una forma de mano (prototipo de una letra). */
export interface Proto {
  shape: number[];
  shape3: number[];
  curl: number[];
  thumb: number[];
  spread: number[];
  axis: number;
  normal: P3;
}

export type FeatureGroup = 'shape' | 'shape3' | 'curl' | 'thumb' | 'spread' | 'axis' | 'normal';

/** Un keyframe de la plantilla dinámica: forma + posición del punto que traza. */
export interface DynKeyframe {
  p: Proto;
  /** posición del punto clave relativa al inicio, en tamaños de mano */
  tr: [number, number];
}

export interface DynTemplate {
  /** landmark que traza el movimiento: 0 = muñeca, 8 = punta del índice, 20 = punta del meñique */
  keyPoint: 0 | 8 | 20;
  frames: DynKeyframe[];
  /** extensión total del trazo (tamaños de mano) */
  extent: number;
  /** duración del movimiento en el video (s) */
  duration: number;
  /** esqueletos 2D (21 pts, sin rotar) para animar el hint */
  disp: number[][];
  /** trayectoria del punto clave para dibujar en el hint (relativa a la muñeca inicial) */
  path: [number, number][];
}

export interface LetterRef {
  id: string;
  tipo: 'estatica' | 'dinamica';
  proto: Proto;
  /** 21 puntos 2D (sin rotar) para dibujar el hint */
  disp: number[];
  /** umbral de distancia (unidades de ruido) para aceptar la forma */
  threshold: number;
  /** umbral de costo DTW para dinámicas */
  dynThreshold?: number;
  template?: DynTemplate;
  stats: {
    frames: number;
    motion: number;
    intraP50: number;
    intraP90: number;
    nearest: { id: string; d: number };
  };
}

export interface AlphabetReference {
  version: number;
  generatedAt: string;
  /** etiqueta de MediaPipe de la mano del firmante de referencia (sin espejar) */
  refLabel: 'Left' | 'Right';
  /** escala típica de ruido por grupo de rasgos (para normalizar) */
  scales: Record<FeatureGroup, number>;
  weights: Record<FeatureGroup, number>;
  letters: LetterRef[];
}
