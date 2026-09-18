/**
 * Evaluación offline del reconocedor (npm run eval). Reproduce en "tiempo
 * real" los landmarks grabados de cada letra (pasada normal = mano derecha,
 * pasada espejada = mano izquierda) y comprueba:
 *   - que la letra correcta se valide (y cuánto tarda),
 *   - que las demás letras NO se validen con esa seña (falsos positivos).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Recognizer } from '../../src/recognizer/recognizer';
import type { AlphabetReference } from '../../src/recognizer/types';
import type { HandObs, P3 } from '../../src/vision/types';
import { loadRaw, OUT, ROOT, type RawFile } from '../extractor/common';

const ref: AlphabetReference = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'alphabet_reference.json'), 'utf8'));
const segs: { letter: string; start: number; end: number }[] = JSON.parse(
  readFileSync(join(OUT, 'segments.json'), 'utf8'),
).segments;
const ids = ref.letters.map((l) => l.id);
const STEP = 0.15;
const HARD = process.argv.includes('--hard');
const PERTURB = HARD || process.argv.includes('--perturb');
// PERTURB_SCALE multiplica la perturbación (para buscar el punto de quiebre)
const K = Number(process.env.PERTURB_SCALE ?? 1);
const ROT = (HARD ? 30 : 20) * K;
const FING = (HARD ? 0.15 : 0.1) * K;
const NOISE = (HARD ? 0.03 : 0.02) * K;
const YAW = (HARD ? 25 : 0) * K;

// ---- perturbación: simula otra persona (giro, proporciones, temblor) ----
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const CHAINS = [
  [0, 1, 2, 3, 4],
  [0, 5, 6, 7, 8],
  [0, 9, 10, 11, 12],
  [0, 13, 14, 15, 16],
  [0, 17, 18, 19, 20],
];
interface Person {
  theta: number;
  yaw: number;
  fingerScale: number[];
}
function newPerson(): Person {
  return {
    theta: ((rnd() * 2 - 1) * ROT * Math.PI) / 180,
    yaw: ((rnd() * 2 - 1) * YAW * Math.PI) / 180,
    fingerScale: CHAINS.map(() => 1 + (rnd() * 2 - 1) * FING),
  };
}
function perturbPts(pts: P3[], p: Person, noise: number): P3[] {
  const o = pts[0];
  const c = Math.cos(p.theta);
  const s = Math.sin(p.theta);
  const cy = Math.cos(p.yaw);
  const sy = Math.sin(p.yaw);
  const rot: P3[] = pts.map((q) => {
    const x0 = q[0] - o[0];
    const z0 = q[2] - o[2];
    // inclinación 3D (giro alrededor del eje vertical) y después giro en el plano
    const x = x0 * cy + z0 * sy;
    const z = -x0 * sy + z0 * cy;
    const y = q[1] - o[1];
    return [o[0] + x * c - y * s, o[1] + x * s + y * c, o[2] + z];
  });
  const out: P3[] = rot.map((q) => [...q] as P3);
  CHAINS.forEach((ch, fi) => {
    for (let k = 2; k < ch.length; k++) {
      const a = ch[k - 1];
      const b = ch[k];
      for (let d = 0; d < 3; d++) out[b][d] = out[a][d] + (rot[b][d] - rot[a][d]) * p.fingerScale[fi];
    }
  });
  return out.map((q) => [q[0] + gauss() * noise, q[1] + gauss() * noise, q[2] + gauss() * noise]);
}
function perturbHands(hands: HandObs[], p: Person): HandObs[] {
  return hands.map((h) => {
    const size = Math.hypot(h.lm[9][0] - h.lm[0][0], h.lm[9][1] - h.lm[0][1]);
    return { ...h, lm: perturbPts(h.lm, p, size * NOISE), wl: perturbPts(h.wl, p, 0.0015 * (NOISE / 0.02)) };
  });
}

interface Row {
  letter: string;
  okAt: number | null;
  falses: string[];
  /** diagnóstico si falló: mejor momento (distancia/umbral y la letra más cercana) */
  why?: string;
}

function run(raw: RawFile, label: string): Row[] {
  const rows: Row[] = [];
  for (const s of segs) {
    const rec = new Recognizer(ref);
    const frames = raw.frames.filter((f) => f.t >= s.start && f.t < s.end);
    let nextEval = s.start + 0.3;
    let okAt: number | null = null;
    const falses = new Set<string>();
    const person = newPerson();
    let bestRatio = Infinity;
    let why = '';
    const isDyn = ref.letters.find((l) => l.id === s.letter)!.tipo === 'dinamica';
    for (const f of frames) {
      rec.push(f.t, PERTURB ? perturbHands(f.hands, person) : f.hands);
      if (f.t < nextEval) continue;
      nextEval = f.t + STEP;
      if (okAt === null) {
        const e = rec.evaluate(s.letter, f.t);
        if (e.closeness < bestRatio) {
          bestRatio = e.closeness;
          const rk = isDyn ? [] : rec.debugRanking(f.t).slice(0, 3);
          why = `d/umbral=${e.closeness.toFixed(2)} ${e.status} ${rk.map((x) => `${x.id}:${x.d.toFixed(2)}/${x.thr.toFixed(2)}`).join(' ')} ${e.hints.join('; ')}`;
        }
      }
      for (const id of ids) {
        const e = rec.evaluate(id, f.t);
        if (e.status !== 'ok') continue;
        if (id === s.letter) okAt ??= f.t - s.start;
        else falses.add(id);
      }
    }
    rows.push({ letter: s.letter, okAt, falses: [...falses], why: okAt === null ? why : undefined });
  }
  const hits = rows.filter((r) => r.okAt !== null).length;
  const fp = rows.reduce((n, r) => n + r.falses.length, 0);
  console.log(`\n=== ${label}: ${hits}/${rows.length} letras validadas, ${fp} falsos positivos ===`);
  for (const r of rows) {
    const tipo = ref.letters.find((l) => l.id === r.letter)!.tipo === 'dinamica' ? 'din' : 'est';
    console.log(
      `${r.letter.padEnd(3)} ${tipo} ${r.okAt === null ? '  ✗ NO    ' : `✓ ${r.okAt.toFixed(1).padStart(4)}s  `}` +
        (r.falses.length ? `falsos: ${r.falses.join(' ')}` : '') +
        (r.why ? `  [${r.why}]` : ''),
    );
  }
  return rows;
}

// --file=raw_frames_full.json evalúa un único archivo (p. ej. el cuadro completo 16:9)
const fileArg = process.argv.find((x) => x.startsWith('--file='))?.slice(7);
let a: Row[] = [];
let b: Row[] = [];
if (fileArg) {
  a = run(loadRaw(fileArg), fileArg);
} else {
  a = run(loadRaw('raw_frames.json'), 'pasada normal (mano derecha)');
  try {
    b = run(loadRaw('raw_frames_mirror.json'), 'pasada espejada (mano izquierda)');
  } catch {
    console.log('(sin pasada espejada)');
  }
}
const all = [...a, ...b];
const hits = all.filter((r) => r.okAt !== null).length;
const fps = all.reduce((n, r) => n + r.falses.length, 0);
console.log(`\nTOTAL: ${hits}/${all.length} validadas · ${fps} falsos positivos (de ${all.length * (ids.length - 1)} pruebas)`);
