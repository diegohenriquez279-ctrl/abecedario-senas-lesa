/**
 * Constantes ajustables del juego y del reconocedor, en un solo lugar.
 * Los umbrales por letra vienen de src/data/alphabet_reference.json (los
 * sugiere el extractor) y se pueden sobreescribir en LETTER_OVERRIDES.
 */
export const CONFIG = {
  /** Letras por ronda. */
  roundSize: 6,
  /** Duración total de la ronda (s). */
  roundSeconds: 120,
  /** Semáforo: verde por encima de esta fracción del tiempo, rojo por debajo de la otra. */
  timerGreenAbove: 0.5,
  timerRedBelow: 0.25,
  /** Puntaje = aciertos * pesoAciertos + fracción de tiempo restante * pesoTiempo (suman 100). */
  scoreWeightHits: 85,
  scoreWeightTime: 15,
  /** Aprobado a partir de este puntaje (0..100). */
  passScore: 75,
  /** Pausa (ms) tras validar una letra antes de pasar a la siguiente. */
  successPauseMs: 1100,

  // ----- reconocedor -----
  /** Ventana (s) durante la que hay que sostener una letra estática. */
  holdSeconds: 0.6,
  /** Fracción mínima de frames con mano detectada dentro de la ventana. */
  minCoverage: 0.6,
  /** Multiplicador global sobre los umbrales por letra (>1 = más permisivo). */
  thresholdScale: 1.0,
  /** La letra objetivo puede estar hasta este factor por encima de la mejor alternativa. */
  rankTolerance: 1.05,
  /** Velocidad máxima de la muñeca (tamaños de mano / s) para considerar la mano quieta. */
  maxStillSpeed: 1.6,
  /** Dispersión máxima de la muñeca dentro de la ventana (tamaños de mano). */
  maxWander: 0.35,
  /** Buffer de movimiento para letras dinámicas (s). */
  dynamicBufferSeconds: 3.2,
  /** Multiplicador global sobre los umbrales DTW (>1 = más permisivo). */
  dynThresholdScale: 1.0,
  /** Cada cuánto se evalúa (ms). */
  evalIntervalMs: 150,
} as const;

/** Ajustes finos por letra: multiplicadores sobre el umbral sugerido. */
export const LETTER_OVERRIDES: Record<string, { threshold?: number; dyn?: number }> = {};
