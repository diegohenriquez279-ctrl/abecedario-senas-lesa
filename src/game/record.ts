/**
 * Récord del juego = mejor PUNTAJE (0–100), guardado en localStorage.
 *
 * La clave y la forma del valor son un contrato con el hub de GameHut, que lo
 * leerá sin cambios del lado del juego. No renombrar:
 *   clave: "gamehut_score_lesa-abecedario"
 *   valor: { "puntos": <entero 0–100>, "fecha": <ISO del momento en que se logró> }
 * (se usa "puntos", no "score" ni "record", para no chocar con el lector de
 * récords por tiempo del hub).
 */
export const RECORD_KEY = 'gamehut_score_lesa-abecedario';

export interface BestScore {
  puntos: number;
  fecha: string;
}

export interface RecordResult {
  /** récord vigente después de esta ronda (null si no se pudo leer ni guardar) */
  best: BestScore | null;
  /** esta ronda superó al récord anterior (un primer 0 se guarda pero no se festeja) */
  isNew: boolean;
}

function isBestScore(v: unknown): v is BestScore {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    Number.isInteger(o.puntos) &&
    (o.puntos as number) >= 0 &&
    (o.puntos as number) <= 100 &&
    typeof o.fecha === 'string' &&
    !Number.isNaN(Date.parse(o.fecha))
  );
}

/** Lee el mejor puntaje guardado. Devuelve null si no hay, si es inválido o si localStorage falla. */
export function readBest(): BestScore | null {
  try {
    const raw = localStorage.getItem(RECORD_KEY);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return isBestScore(v) ? { puntos: v.puntos, fecha: v.fecha } : null;
  } catch {
    return null;
  }
}

/**
 * Guarda `puntos` si supera al récord actual (un empate no lo reemplaza).
 * Nunca lanza: si localStorage falla, el juego sigue igual.
 */
export function saveIfBest(puntos: number, now: Date = new Date()): RecordResult {
  const value = Math.max(0, Math.min(100, Math.round(puntos)));
  const prev = readBest();
  if (prev && value <= prev.puntos) return { best: prev, isNew: false };
  const best: BestScore = { puntos: value, fecha: now.toISOString() };
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(best));
  } catch {
    // Sin almacenamiento (p. ej. bloqueado): se muestra igual en esta sesión.
  }
  return { best, isNew: value > 0 };
}
