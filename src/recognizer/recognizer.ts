import { CONFIG, LETTER_OVERRIDES } from '../config';
import { extractFeatures, type HandFeatures } from '../vision/features';
import type { HandObs } from '../vision/types';
import { medianProto, protoDistance, toProto } from './distance';
import { bestDynamicMatch, dynamicAccepted, MAX_EXTENT_RATIO, MIN_EXTENT_RATIO, type DynMatch } from './dtw';
import { describeCorrections } from './feedback';
import type { AlphabetReference, LetterRef, Proto } from './types';

interface BufFrame {
  t: number;
  /** rasgos sin espejar / espejados (mano opuesta a la de referencia) */
  f: [HandFeatures, HandFeatures] | null;
  /** índice de la opción de espejo que sugiere la etiqueta de MediaPipe */
  pref: 0 | 1;
}

export type EvalStatus = 'no-hand' | 'moving' | 'trying' | 'ok';

export interface Evaluation {
  status: EvalStatus;
  /** 0..1 cuánto de la ventana reciente coincide con la letra objetivo */
  progress: number;
  /** distancia actual a la letra objetivo, relativa a su umbral (<1 = dentro) */
  closeness: number;
  /** letra que más se parece a lo que el usuario está haciendo */
  looksLike: string | null;
  /** correcciones sugeridas (máx. 2) */
  hints: string[];
  /** true si el usuario usa la mano opuesta a la del firmante de referencia */
  mirroredHand: boolean;
}

/** Deriva neta de la muñeca (tamaños de mano / s) entre el primer y el último tercio de la ventana. */
export function wristDrift(win: { t: number; f: HandFeatures }[]): number {
  if (win.length < 3) return 0;
  const k = Math.max(1, Math.floor(win.length / 3));
  const avg = (xs: typeof win) => {
    let x = 0, y = 0, t = 0, s = 0;
    for (const w of xs) {
      x += w.f.wrist[0];
      y += w.f.wrist[1];
      t += w.t;
      s += w.f.size;
    }
    const n = xs.length;
    return { x: x / n, y: y / n, t: t / n, s: s / n };
  };
  const a = avg(win.slice(0, k));
  const b = avg(win.slice(-k));
  const dt = Math.max(1e-3, b.t - a.t);
  return Math.hypot(b.x - a.x, b.y - a.y) / ((a.s + b.s) / 2) / dt;
}

/** Dispersión máxima de la muñeca respecto de su promedio (tamaños de mano): detecta idas y vueltas. */
export function wristWander(win: { t: number; f: HandFeatures }[]): number {
  if (!win.length) return 0;
  let x = 0, y = 0, s = 0;
  for (const w of win) {
    x += w.f.wrist[0];
    y += w.f.wrist[1];
    s += w.f.size;
  }
  x /= win.length;
  y /= win.length;
  s /= win.length;
  const d = win.map((w) => Math.hypot(w.f.wrist[0] - x, w.f.wrist[1] - y) / s).sort((a, b) => a - b);
  return d[Math.floor(d.length * 0.9)]; // percentil 90 (ignora un frame suelto)
}

/**
 * Reconocedor en streaming, sin estado de juego: se le empujan frames y se le
 * pregunta si la letra objetivo está bien hecha. Reutilizable para la Fase 2
 * ("formá la palabra").
 */
export class Recognizer {
  private buf: BufFrame[] = [];
  private byId = new Map<string, LetterRef>();
  private statics: LetterRef[];
  private dynamics: LetterRef[];
  private lastMirrored = false;

  constructor(private ref: AlphabetReference) {
    for (const l of ref.letters) this.byId.set(l.id, l);
    this.statics = ref.letters.filter((l) => l.tipo === 'estatica');
    this.dynamics = ref.letters.filter((l) => l.tipo === 'dinamica');
  }

  letter(id: string) {
    return this.byId.get(id);
  }

  reset() {
    this.buf = [];
  }

  /** Agrega un frame. Si hay dos manos se usa la más alta (la que está haciendo la seña). */
  push(t: number, hands: HandObs[]) {
    let hand: HandObs | null = null;
    for (const h of hands) if (!hand || h.lm[0][1] < hand.lm[0][1]) hand = h;
    const pref: 0 | 1 = hand && hand.label !== this.ref.refLabel ? 1 : 0;
    this.buf.push({
      t,
      f: hand ? [extractFeatures(hand, false), extractFeatures(hand, true)] : null,
      pref,
    });
    const keep = CONFIG.dynamicBufferSeconds + 0.5;
    while (this.buf.length && this.buf[0].t < t - keep) this.buf.shift();
  }

  private threshold(l: LetterRef) {
    return l.threshold * CONFIG.thresholdScale * (LETTER_OVERRIDES[l.id]?.threshold ?? 1);
  }

  private dist(a: Proto, b: Proto) {
    return protoDistance(a, b, this.ref.scales, this.ref.weights);
  }

  /** Elige la opción de espejo (0/1) que mejor explica la ventana para la letra dada. */
  private pickMirror(win: BufFrame[], target: Proto): { m: 0 | 1; proto: Proto; d: number } {
    const votes = win.reduce((s, f) => s + f.pref, 0);
    const pref: 0 | 1 = votes * 2 > win.length ? 1 : 0;
    const p0 = medianProto(win.map((f) => toProto(f.f![0])));
    const p1 = medianProto(win.map((f) => toProto(f.f![1])));
    const d0 = this.dist(p0, target) * (pref === 0 ? 1 : 1.1);
    const d1 = this.dist(p1, target) * (pref === 1 ? 1 : 1.1);
    return d0 <= d1 ? { m: 0, proto: p0, d: d0 } : { m: 1, proto: p1, d: d1 };
  }

  evaluate(targetId: string, now: number): Evaluation {
    const target = this.byId.get(targetId);
    if (!target) throw new Error('Letra desconocida ' + targetId);
    return target.tipo === 'dinamica' ? this.evalDynamic(target, now) : this.evalStatic(target, now);
  }

  private window(now: number, secs: number) {
    return this.buf.filter((f) => f.t > now - secs && f.t <= now);
  }

  private noHand(): Evaluation {
    return {
      status: 'no-hand',
      progress: 0,
      closeness: Infinity,
      looksLike: null,
      hints: [],
      mirroredHand: this.lastMirrored,
    };
  }

  private evalStatic(target: LetterRef, now: number): Evaluation {
    const all = this.window(now, CONFIG.holdSeconds);
    const win = all.filter((f) => f.f);
    const recent = this.window(now, 0.35).filter((f) => f.f);
    if (!recent.length || win.length < 3) return this.noHand();
    const coverage = win.length / Math.max(1, all.length);

    const { m, proto, d } = this.pickMirror(win, target.proto);
    this.lastMirrored = m === 1;
    const thr = this.threshold(target);

    // Estabilidad: deriva neta de la muñeca (promedio del primer tercio vs. el
    // último) en tamaños de mano por segundo. No depende de los fps ni del
    // temblor de los landmarks, a diferencia de la velocidad frame a frame.
    const wf = win.map((f) => ({ t: f.t, f: f.f![m] }));
    const still = wristDrift(wf) < CONFIG.maxStillSpeed && wristWander(wf) < CONFIG.maxWander;

    // Progreso: fracción de frames individuales dentro del umbral
    const within = win.filter((f) => this.dist(toProto(f.f![m]), target.proto) < thr * 1.15).length;
    const progress = Math.min(1, (within / win.length) * coverage * 1.1);

    // Letra más parecida (solo estáticas: una mano quieta no puede ser una dinámica)
    let best: LetterRef | null = null;
    let bestD = Infinity;
    for (const l of this.statics) {
      if (l.id === target.id) continue;
      const dl = this.dist(proto, l.proto);
      if (dl < bestD) {
        bestD = dl;
        best = l;
      }
    }
    const rankOk = d <= bestD * CONFIG.rankTolerance || d < thr * 0.3;
    const ok = still && coverage >= CONFIG.minCoverage && d < thr && rankOk;

    let hints: string[] = [];
    if (!ok) {
      if (!still) hints = ['Quedate quieto un momento con la mano en posición'];
      else {
        hints = describeCorrections(proto, target.proto);
        if (!hints.length && best && !rankOk) hints = [`Se parece a la ${best.id}: fijate en el dibujo`];
        if (!hints.length) hints = ['¡Casi! Ajustá la forma como en el dibujo'];
      }
    }
    return {
      status: ok ? 'ok' : still ? 'trying' : 'moving',
      progress: ok ? 1 : progress,
      closeness: d / thr,
      looksLike: best && bestD < d && bestD < this.threshold(best) ? best.id : null,
      hints,
      mirroredHand: m === 1,
    };
  }

  private evalDynamic(target: LetterRef, now: number): Evaluation {
    const tpl = target.template!;
    const recent = this.window(now, 0.35).filter((f) => f.f);
    if (!recent.length) return this.noHand();
    const dynThr =
      (target.dynThreshold ?? 1) * CONFIG.dynThresholdScale * (LETTER_OVERRIDES[target.id]?.dyn ?? 1);

    const frames = this.window(now, CONFIG.dynamicBufferSeconds);
    const votes = frames.filter((f) => f.f).reduce((s, f) => s + f.pref, 0);
    const pref: 0 | 1 = votes * 2 > frames.filter((f) => f.f).length ? 1 : 0;
    const shapeDist = (a: Proto, b: Proto) => this.dist(a, b) / target.threshold;

    let best: { m: 0 | 1; match: DynMatch; cost: number } | null = null;
    for (const m of [0, 1] as const) {
      const match = bestDynamicMatch(
        frames.map((f) => ({ t: f.t, f: f.f ? f.f[m] : null })),
        now,
        tpl,
        shapeDist,
        { maxWindow: CONFIG.dynamicBufferSeconds, minCoverage: CONFIG.minCoverage },
      );
      if (!match) continue;
      const cost = match.cost * (m === pref ? 1 : 1.1);
      if (!best || cost < best.cost) best = { m, match: { ...match, cost }, cost };
    }
    if (!best) {
      return { ...this.noHand(), status: 'trying', hints: ['Mostrá la mano y hacé el movimiento'] };
    }
    this.lastMirrored = best.m === 1;
    const mt = best.match;
    const ok = dynamicAccepted(mt, dynThr);

    let hints: string[] = [];
    if (!ok) {
      const proto = medianProto(mt.seq.map((s) => toProto(s)));
      if (mt.shapeCost > 1.3) {
        const corr = describeCorrections(proto, tpl.frames[0].p, 1);
        hints = ['Empezá con la mano como en el dibujo', ...corr];
      } else if (mt.extentRatio < MIN_EXTENT_RATIO) hints = ['Falta el movimiento: hacelo como en la animación'];
      else if (mt.extentRatio > MAX_EXTENT_RATIO) hints = ['El movimiento fue muy grande: hacelo más corto'];
      else if (!mt.endOk) hints = ['Al terminar el movimiento, quedate quieto un momento'];
      else if (mt.endErr > 0.6) hints = ['Fijate hacia dónde termina el movimiento en la animación'];
      else hints = ['Buen intento: seguí el recorrido de la animación'];
    }
    return {
      status: ok ? 'ok' : 'trying',
      progress: ok ? 1 : Math.max(0, Math.min(0.95, 1.4 - mt.cost / dynThr)),
      closeness: mt.cost / dynThr,
      looksLike: null,
      hints,
      mirroredHand: best.m === 1,
    };
  }

  /** Para diagnóstico: distancias de la ventana actual a todas las letras estáticas. */
  debugRanking(now: number): { id: string; d: number; thr: number }[] {
    const win = this.window(now, CONFIG.holdSeconds).filter((f) => f.f);
    if (win.length < 3) return [];
    return this.statics
      .map((l) => ({ id: l.id, d: this.pickMirror(win, l.proto).d, thr: this.threshold(l) }))
      .sort((a, b) => a.d - b.d);
  }

  get dynamicLetters() {
    return this.dynamics;
  }
}
