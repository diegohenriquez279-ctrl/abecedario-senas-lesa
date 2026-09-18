import { CONFIG } from '../config';

export type Screen = 'inicio' | 'juego' | 'resultado';
export type LetterResult = 'ok' | 'saltada' | 'pendiente';

export interface GameState {
  screen: Screen;
  /** letras de la ronda */
  letters: string[];
  results: LetterResult[];
  index: number;
  /** segundos restantes */
  timeLeft: number;
  /** true si la ronda terminó por tiempo */
  timedOut: boolean;
  /** la letra actual se acaba de validar (pausa de festejo) */
  celebrating: boolean;
}

export type GameAction =
  | { type: 'start'; letters: string[] }
  | { type: 'tick'; timeLeft: number }
  | { type: 'hit' }
  | { type: 'next' }
  | { type: 'skip' }
  | { type: 'home' };

export const initialState: GameState = {
  screen: 'inicio',
  letters: [],
  results: [],
  index: 0,
  timeLeft: CONFIG.roundSeconds,
  timedOut: false,
  celebrating: false,
};

function advance(s: GameState, results: LetterResult[]): GameState {
  const index = s.index + 1;
  if (index >= s.letters.length) return { ...s, results, index, celebrating: false, screen: 'resultado' };
  return { ...s, results, index, celebrating: false };
}

export function reducer(s: GameState, a: GameAction): GameState {
  switch (a.type) {
    case 'start':
      return {
        ...initialState,
        screen: 'juego',
        letters: a.letters,
        results: a.letters.map(() => 'pendiente'),
      };
    case 'tick':
      if (s.screen !== 'juego') return s;
      if (a.timeLeft <= 0) return { ...s, timeLeft: 0, timedOut: true, celebrating: false, screen: 'resultado' };
      return { ...s, timeLeft: a.timeLeft };
    case 'hit': {
      if (s.screen !== 'juego' || s.celebrating) return s;
      const results = [...s.results];
      results[s.index] = 'ok';
      return { ...s, results, celebrating: true };
    }
    case 'next':
      if (s.screen !== 'juego' || !s.celebrating) return s;
      return advance(s, s.results);
    case 'skip': {
      if (s.screen !== 'juego' || s.celebrating) return s;
      const results = [...s.results];
      results[s.index] = 'saltada';
      return advance(s, results);
    }
    case 'home':
      return initialState;
  }
}

/** Elige `n` letras al azar sin repetir. */
export function pickLetters(all: string[], n: number): string[] {
  const pool = [...all];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}

export interface Score {
  hits: number;
  misses: number;
  total: number;
  timeUsed: number;
  score: number;
  passed: boolean;
}

/** Puntaje = aciertos (85%) + tiempo restante (15%). Aprobado ≥ 75. */
export function computeScore(s: GameState): Score {
  const total = s.letters.length || 1;
  const hits = s.results.filter((r) => r === 'ok').length;
  const timeFrac = Math.max(0, s.timeLeft) / CONFIG.roundSeconds;
  const score = Math.round((hits / total) * CONFIG.scoreWeightHits + timeFrac * CONFIG.scoreWeightTime);
  return {
    hits,
    misses: total - hits,
    total,
    timeUsed: Math.round(CONFIG.roundSeconds - s.timeLeft),
    score,
    passed: score >= CONFIG.passScore,
  };
}

export type TimerColor = 'verde' | 'amarillo' | 'rojo';
export function timerColor(timeLeft: number): TimerColor {
  const f = timeLeft / CONFIG.roundSeconds;
  if (f > CONFIG.timerGreenAbove) return 'verde';
  if (f > CONFIG.timerRedBelow) return 'amarillo';
  return 'rojo';
}
