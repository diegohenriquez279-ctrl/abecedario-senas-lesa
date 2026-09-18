/**
 * Genera src/data/alphabet_reference.json a partir de los landmarks crudos
 * que produjo el extractor (tools/extractor/out/raw_frames*.json).
 *
 *   npm run build:reference            (usa overrides.json si existe)
 *
 * Pasos: 1) segmenta por letra con los picos de cambio de la zona de la
 * letra escrita; 2) por letra toma los frames con la mano quieta y calcula el
 * prototipo (mediana robusta); 3) si dentro de una subida de mano hay pausa →
 * movimiento → pausa (en la forma de la letra) → "dinamica" + plantilla DTW;
 * 4) escalas por grupo de rasgos, umbrales por letra y calibración DTW contra
 * la pasada espejada y las demás letras.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LETTERS } from '../../src/data/letters';
import { GROUPS, groupDistances, medianProto, protoDistance, toProto } from '../../src/recognizer/distance';
import { bestDynamicMatch, dynamicAccepted, extentOf, resampleWindow, trajectoryOf } from '../../src/recognizer/dtw';
import type { AlphabetReference, DynTemplate, FeatureGroup, LetterRef, Proto } from '../../src/recognizer/types';
import { extractFeatures, type HandFeatures } from '../../src/vision/features';
import { median } from '../../src/vision/geometry';
import { activeHand, loadRaw, OUT, ROOT, type RawFile, type Segment } from './common';

const INTRO_END = 11.0; // antes de esto es la intro animada
const TEMPLATE_FRAMES = 16;

interface Overrides {
  /** límites manuales: letra → [inicio, fin] */
  segments?: Record<string, [number, number]>;
  /** forzar tipo */
  tipo?: Record<string, 'estatica' | 'dinamica'>;
  /** ventana manual del movimiento para la plantilla: letra → [inicio, fin] */
  movement?: Record<string, [number, number]>;
}
const overridesPath = join(ROOT, 'tools', 'extractor', 'overrides.json');
const overrides: Overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {};

const rawA = loadRaw('raw_frames.json');
const rawB = existsSync(join(OUT, 'raw_frames_mirror.json')) ? loadRaw('raw_frames_mirror.json') : null;
console.log(`frames: ${rawA.frames.length} (espejo: ${rawB?.frames.length ?? 0})`);

// ---------------------------------------------------------------------------
// 1) Segmentación por cambios en la zona de la letra escrita
function segment(raw: RawFile): Segment[] {
  const fr = raw.frames.filter((f) => f.t >= INTRO_END);
  const vals = fr.map((f) => f.roi);
  const base = median(vals);
  const thr = Math.max(2.5, base * 6);
  const cands: { t: number; v: number }[] = [];
  for (let i = 1; i < fr.length - 1; i++) {
    if (vals[i] >= thr && vals[i] >= vals[i - 1] && vals[i] >= vals[i + 1]) cands.push({ t: fr[i].t, v: vals[i] });
  }
  // supresión de no-máximos: una transición cada ≥ 3 s
  const picked: { t: number; v: number }[] = [];
  for (const c of [...cands].sort((a, b) => b.v - a.v)) {
    if (picked.every((p) => Math.abs(p.t - c.t) > 3)) picked.push(c);
  }
  picked.sort((a, b) => a.t - b.t);
  console.log(`picos de cambio (${picked.length}, umbral ${thr.toFixed(1)}):`);
  console.log(picked.map((p) => `${p.t.toFixed(1)}(${p.v.toFixed(0)})`).join(' '));

  // Se necesitan N+1 límites (inicio de A … fin de Z). Cada letra dura
  // parecido: los huecos muy largos esconden una transición más débil (se
  // busca el máximo local dentro del hueco) y los tramos muy cortos se funden.
  const bounds = picked.map((p) => ({ ...p }));
  const spacing = () => median(bounds.slice(1).map((b, i) => b.t - bounds[i].t));
  for (let guard = 0; guard < 10; guard++) {
    const sp = spacing();
    const gi = bounds.findIndex((b, i) => i > 0 && b.t - bounds[i - 1].t > sp * 1.6);
    if (gi < 0) break;
    const a = bounds[gi - 1].t + 2;
    const b = bounds[gi].t - 2;
    const inGap = fr.filter((f) => f.t > a && f.t < b);
    if (!inGap.length) break;
    // pico más fuerte, favoreciendo el punto medio (las letras duran parecido)
    const mid = (bounds[gi - 1].t + bounds[gi].t) / 2;
    const w = (bounds[gi].t - bounds[gi - 1].t) / 4;
    const score = (f: { t: number; roi: number }) => f.roi * Math.exp(-(((f.t - mid) / w) ** 2));
    const m = inGap.reduce((x, y) => (score(y) > score(x) ? y : x));
    console.log(`  hueco ${bounds[gi - 1].t.toFixed(1)}–${bounds[gi].t.toFixed(1)}: transición débil en ${m.t.toFixed(1)} (${m.roi})`);
    bounds.splice(gi, 0, { t: m.t, v: m.roi });
  }
  for (let guard = 0; guard < 10; guard++) {
    const sp = spacing();
    const si = bounds.findIndex((b, i) => i > 0 && b.t - bounds[i - 1].t < sp * 0.5);
    if (si < 0) break;
    const drop = bounds[si].v < bounds[si - 1].v ? si : si - 1;
    console.log(`  tramo corto: se descarta el límite ${bounds[drop].t.toFixed(1)}`);
    bounds.splice(drop, 1);
  }
  if (bounds.length !== LETTERS.length + 1) {
    console.warn(`⚠ ${bounds.length} límites (se esperaban ${LETTERS.length + 1}); revisá overrides.json`);
  }
  const end = raw.video.duration;
  const segs: Segment[] = LETTERS.map((l, i) => ({
    letter: l.id,
    start: bounds[i]?.t ?? end,
    end: bounds[i + 1]?.t ?? end,
  }));
  for (const s of segs) {
    const o = overrides.segments?.[s.letter];
    if (o) [s.start, s.end] = o;
  }
  return segs;
}

// ---------------------------------------------------------------------------
// 2) Frames por letra
interface LF {
  t: number;
  f: HandFeatures;
  p: Proto;
  speed: number; // muñeca, tamaños de mano / s
  tipSpeed: number; // máx. de punta índice/meñique relativa a la muñeca (tamaños/s)
}

function letterFrames(raw: RawFile, s: Segment, flip: boolean): LF[] {
  const out: LF[] = [];
  const fr = raw.frames.filter((f) => f.t >= s.start + 0.25 && f.t < s.end - 0.1);
  for (const f of fr) {
    const h = activeHand(f);
    if (!h) continue;
    const feats = extractFeatures(h, flip);
    out.push({ t: f.t, f: feats, p: toProto(feats), speed: 0, tipSpeed: 0 });
  }
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 1)];
    const b = out[Math.min(out.length - 1, i + 1)];
    const dt = b.t - a.t;
    if (dt <= 0 || dt > 0.3) {
      out[i].speed = Infinity;
      out[i].tipSpeed = Infinity;
      continue;
    }
    const sz = out[i].f.size;
    out[i].speed = Math.hypot(b.f.wrist[0] - a.f.wrist[0], b.f.wrist[1] - a.f.wrist[1]) / sz / dt;
    const rel = (x: HandFeatures, k: number) => [x.tips[k] - x.wrist[0], x.tips[k + 1] - x.wrist[1]];
    let ts = 0;
    for (const k of [0, 2]) {
      const ra = rel(a.f, k);
      const rb = rel(b.f, k);
      ts = Math.max(ts, Math.hypot(rb[0] - ra[0], rb[1] - ra[1]) / sz / dt);
    }
    out[i].tipSpeed = ts;
  }
  return out;
}

const ONES = Object.fromEntries(GROUPS.map((g) => [g, 1])) as Record<FeatureGroup, number>;
let SCALES = { ...ONES };
const WEIGHTS: Record<FeatureGroup, number> = {
  shape: 1.2,
  shape3: 1.0,
  curl: 1.2,
  thumb: 0.8,
  spread: 0.6,
  axis: 0.8,
  normal: 0.8,
};
const dist = (a: Proto, b: Proto) => protoDistance(a, b, SCALES, WEIGHTS);

/** Prototipo robusto: mediana de los frames quietos, recortando el 40% más alejado. */
function robustProto(frames: LF[]): { proto: Proto; used: LF[] } {
  let used = frames.filter((f) => f.speed < 1.2);
  if (used.length < 8) used = [...frames].sort((a, b) => a.speed - b.speed).slice(0, Math.max(8, frames.length >> 1));
  let proto = medianProto(used.map((f) => f.p));
  for (let it = 0; it < 2; it++) {
    const ranked = used.map((f) => ({ f, d: dist(f.p, proto) })).sort((a, b) => a.d - b.d);
    used = ranked.slice(0, Math.max(6, Math.ceil(ranked.length * 0.6))).map((r) => r.f);
    proto = medianProto(used.map((f) => f.p));
  }
  return { proto, used };
}

const segs = segment(rawA);
const framesA = new Map(segs.map((s) => [s.letter, letterFrames(rawA, s, false)]));
const framesB = rawB ? new Map(segs.map((s) => [s.letter, letterFrames(rawB, s, true)])) : null;

// Escalas por grupo = diferencia típica ENTRE letras (mediana de las
// distancias entre prototipos). Así 1 unidad ≈ "lo que separa a dos letras
// cualquiera", que generaliza mejor a otras personas que el temblor del
// firmante. Pasada 1 con escalas unitarias → escalas → pasada 2.
let protos = new Map<string, { proto: Proto; used: LF[] }>();
for (let pass = 0; pass < 2; pass++) {
  protos = new Map(segs.map((s) => [s.letter, robustProto(framesA.get(s.letter)!)]));
  const per: Record<FeatureGroup, number[]> = Object.fromEntries(GROUPS.map((g) => [g, []])) as any;
  const ps = [...protos.values()].map((p) => p.proto);
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      const g = groupDistances(ps[i], ps[j]);
      for (const k of GROUPS) per[k].push(g[k]);
    }
  }
  // Las orientaciones tienen zona muerta (muchos pares dan 0): escala fija,
  // 1 unidad ≈ 45° más allá de la zona muerta.
  SCALES = Object.fromEntries(
    GROUPS.map((g) => [g, g === 'axis' || g === 'normal' ? 0.5 : Math.max(1e-3, median(per[g]))]),
  ) as Record<FeatureGroup, number>;
}
console.log('escalas (entre letras):', Object.entries(SCALES).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(' '));

// ---------------------------------------------------------------------------
// 3) Movimiento
// ---- Movimiento entre pausas ----------------------------------------------
// Una letra dinámica muestra, dentro de una misma subida de mano, una pausa →
// un movimiento (la mano se desplaza o cambia de forma) → otra pausa. Subir y
// bajar la mano no cuenta (no hay pausa antes / después dentro del tramo).
interface Hold {
  t0: number;
  t1: number;
  proto: Proto;
}
interface MoveEvent {
  from: Hold;
  to: Hold;
  /** recorrido máximo (muñeca / punta índice / punta meñique), en tamaños de mano */
  path: number;
  pathKey: 0 | 8 | 20;
  /** cambio de forma entre las dos pausas */
  shape: number;
}

function visibleRuns(frames: LF[]): LF[][] {
  const runs: LF[][] = [];
  let cur: LF[] = [];
  for (const f of frames) {
    if (cur.length && f.t - cur[cur.length - 1].t > 0.25) {
      runs.push(cur);
      cur = [];
    }
    cur.push(f);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function holdsOf(run: LF[]): Hold[] {
  // velocidad suavizada (mediana de 3) para no cortar una pausa por un frame ruidoso
  const sm = (k: 'speed' | 'tipSpeed', i: number) =>
    median(run.slice(Math.max(0, i - 1), i + 2).map((f) => (Number.isFinite(f[k]) ? f[k] : 99)));
  const still = run.map((_, i) => sm('speed', i) < 1.1 && sm('tipSpeed', i) < 1.6);
  const holds: { i0: number; i1: number }[] = [];
  let i = 0;
  while (i < run.length) {
    if (!still[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < run.length && still[j + 1]) j++;
    if (run[j].t - run[i].t >= 0.18) holds.push({ i0: i, i1: j });
    i = j + 1;
  }
  // unir pausas separadas por un frame suelto de temblor
  const merged: { i0: number; i1: number }[] = [];
  for (const h of holds) {
    const last = merged[merged.length - 1];
    if (last && h.i0 - last.i1 <= 2) last.i1 = h.i1;
    else merged.push({ ...h });
  }
  return merged.map((h) => ({
    t0: run[h.i0].t,
    t1: run[h.i1].t,
    proto: medianProto(run.slice(h.i0, h.i1 + 1).map((f) => f.p)),
  }));
}

function moveEvents(frames: LF[]): MoveEvent[] {
  const events: MoveEvent[] = [];
  for (const run of visibleRuns(frames)) {
    const hs = holdsOf(run);
    for (let k = 0; k + 1 < hs.length; k++) {
      const a = hs[k];
      const b = hs[k + 1];
      if (b.t0 - a.t1 > 2.5) continue;
      const seg = run.filter((f) => f.t >= a.t1 && f.t <= b.t0);
      const lens = { 0: 0, 8: 0, 20: 0 } as Record<0 | 8 | 20, number>;
      for (let i = 1; i < seg.length; i++) {
        const p = seg[i - 1].f;
        const q = seg[i].f;
        const sz = (p.size + q.size) / 2;
        lens[0] += Math.hypot(q.wrist[0] - p.wrist[0], q.wrist[1] - p.wrist[1]) / sz;
        lens[8] += Math.hypot(q.tips[0] - p.tips[0], q.tips[1] - p.tips[1]) / sz;
        lens[20] += Math.hypot(q.tips[2] - p.tips[2], q.tips[3] - p.tips[3]) / sz;
      }
      const key = (lens[0] * 1.15 >= Math.max(lens[8], lens[20]) ? 0 : lens[8] >= lens[20] ? 8 : 20) as 0 | 8 | 20;
      events.push({ from: a, to: b, path: Math.max(lens[0], lens[8], lens[20]), pathKey: key, shape: dist(a.proto, b.proto) });
    }
  }
  return events;
}

/**
 * Eventos que cuentan como "movimiento de la letra": recorrido o cambio de
 * forma apreciable, y al menos una de las dos pausas en la forma de la letra
 * (descarta bajar la mano a la posición de descanso).
 */
function validEvents(frames: LF[], proto: Proto): MoveEvent[] {
  return moveEvents(frames).filter(
    (e) =>
      (e.path >= 0.8 || e.shape >= 0.4) &&
      Math.min(dist(e.from.proto, proto), dist(e.to.proto, proto)) < 0.35 &&
      e.to.t1 - e.to.t0 >= 0.2,
  );
}

function buildTemplate(frames: LF[], win: [number, number], keyPoint: 0 | 8 | 20): DynTemplate {
  const w = frames.filter((f) => f.t >= win[0] && f.t <= win[1]);
  const seq = resampleWindow(w.map((f) => ({ t: f.t, f: f.f })), TEMPLATE_FRAMES);
  const traj = trajectoryOf(seq, keyPoint);
  const size = seq.reduce((s, f) => s + f.size, 0) / seq.length;
  const w0 = seq[0].wrist;
  const disp = seq.map((f) => {
    const dx = (f.wrist[0] - w0[0]) / size;
    const dy = (f.wrist[1] - w0[1]) / size;
    const out: number[] = [];
    for (let i = 0; i < 42; i += 2) out.push(round(f.disp[i] * (f.size / size) + dx), round(f.disp[i + 1] * (f.size / size) + dy));
    return out;
  });
  const key = (f: HandFeatures): [number, number] =>
    keyPoint === 8 ? [f.tips[0], f.tips[1]] : keyPoint === 20 ? [f.tips[2], f.tips[3]] : f.wrist;
  const path = seq.map((f) => {
    const [x, y] = key(f);
    return [round((x - w0[0]) / size), round((y - w0[1]) / size)] as [number, number];
  });
  return {
    keyPoint,
    frames: seq.map((f, i) => ({ p: roundProto(toProto(f)), tr: [round(traj[i][0]), round(traj[i][1])] })),
    extent: round(extentOf(traj)),
    duration: round(win[1] - win[0]),
    disp,
    path,
  };
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;
function roundProto(p: Proto): Proto {
  return {
    shape: p.shape.map(round),
    shape3: p.shape3.map(round),
    curl: p.curl.map(round),
    thumb: p.thumb.map(round),
    spread: p.spread.map(round),
    axis: round(p.axis),
    normal: p.normal.map(round) as Proto['normal'],
  };
}

// ---------------------------------------------------------------------------
// 4) Armar letras, umbrales y reporte
const letters: LetterRef[] = [];
const segReport: any[] = [];
for (const s of segs) {
  const frames = framesA.get(s.letter)!;
  const { proto, used } = protos.get(s.letter)!;
  const intra = used.map((f) => dist(f.p, proto)).sort((a, b) => a - b);
  const p50 = median(intra);
  const p90 = intra[Math.floor(intra.length * 0.9)] ?? p50;
  if (process.env.DEBUG_LETTERS?.split(',').includes(s.letter)) debugProfile(s, frames, proto);
  letters.push({
    id: s.letter,
    tipo: 'estatica',
    proto: roundProto(proto),
    disp: medianDisp(used),
    threshold: 0,
    stats: { frames: used.length, motion: 0, intraP50: round(p50), intraP90: round(p90), nearest: { id: '', d: 0 } },
  });
}

function debugProfile(s: Segment, frames: LF[], proto: Proto) {
  console.log(`--- perfil ${s.letter} [${s.start.toFixed(1)}–${s.end.toFixed(1)}]`);
  let line = '';
  for (const f of frames) {
    const d = dist(f.p, proto);
    line += `${f.t.toFixed(1)}:${Number.isFinite(f.speed) ? f.speed.toFixed(1) : 'x'}/${Number.isFinite(f.tipSpeed) ? f.tipSpeed.toFixed(1) : 'x'}/${d.toFixed(2)}  `;
  }
  console.log(line);
}

function medianDisp(used: LF[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 42; i++) out.push(round(median(used.map((f) => f.f.disp[i]))));
  return out;
}

// clasificación estática/dinámica por movimiento entre pausas
const templateWin = new Map<string, [number, number]>();
for (const l of letters) {
  const info = LETTERS.find((x) => x.id === l.id)!;
  const frames = framesA.get(l.id)!;
  const ev = validEvents(frames, protos.get(l.id)!.proto);
  const best = ev.reduce<MoveEvent | null>((x, e) => (!x || e.path + e.shape > x.path + x.shape ? e : x), null);
  l.stats.motion = round(best ? best.path : 0);
  let tipo: 'estatica' | 'dinamica' = best ? 'dinamica' : 'estatica';
  if (overrides.tipo?.[l.id]) tipo = overrides.tipo[l.id];
  l.tipo = tipo;
  if (tipo === 'dinamica') {
    const win: [number, number] | null = overrides.movement?.[l.id] ?? (best ? [best.from.t1 - 0.12, best.to.t0 + 0.12] : null);
    if (!win) {
      console.warn(`⚠ ${l.id}: forzada dinámica pero sin tramo de movimiento → estática`);
      l.tipo = 'estatica';
    } else {
      templateWin.set(l.id, win);
      l.template = buildTemplate(frames, win, best?.pathKey ?? 0);
    }
  }
  const flag = info.priorTipo !== 'revisar' && info.priorTipo !== l.tipo ? '  ⚠ difiere del prior' : '';
  console.log(
    `${l.id.padEnd(3)} ${l.tipo.padEnd(9)} n=${String(l.stats.frames).padStart(3)} ` +
      `p50=${l.stats.intraP50.toFixed(2)} p90=${l.stats.intraP90.toFixed(2)}` +
      (ev.length ? ` eventos: ${ev.map((e) => `${e.from.t1.toFixed(1)}→${e.to.t0.toFixed(1)} rec=${e.path.toFixed(1)}@${e.pathKey} forma=${e.shape.toFixed(2)}`).join(', ')}` : '') +
      (l.template ? `
      plantilla ${l.template.duration.toFixed(2)}s key=${l.template.keyPoint} ext=${l.template.extent.toFixed(2)} tr=${l.template.frames.map((f) => f.tr.map((v) => v.toFixed(1)).join(',')).join(' ')}` : '') +
      flag,
  );
}

// umbral por letra: generoso respecto del ruido propio, acotado por la letra más cercana
for (const l of letters) {
  let nearest = { id: '', d: Infinity };
  for (const o of letters) {
    // una estática compite solo con estáticas (igual que el ranking del
    // reconocedor): su gemela dinámica se distingue por el movimiento
    if (o.id === l.id || (l.tipo === 'estatica' && o.tipo === 'dinamica')) continue;
    const d = dist(l.proto, o.proto);
    if (d < nearest.d) nearest = { id: o.id, d };
  }
  l.stats.nearest = { id: nearest.id, d: round(nearest.d) };
  // generoso respecto del ruido propio, pero sin pasar de ~60% de la distancia
  // a la letra más parecida (el chequeo de ranking hace el resto)
  // (1 unidad ≈ diferencia típica entre dos letras). El chequeo de ranking del
  // reconocedor separa las letras parecidas; este umbral solo rechaza formas
  // que no se parecen a ninguna letra.
  const base = Math.max(0.45, l.stats.intraP90 * 4);
  l.threshold = round(Math.min(1.0, Math.max(base, nearest.d * 0.8)));
}

// matriz de confusión de prototipos (pares más cercanos)
const pairs: { a: string; b: string; d: number }[] = [];
for (let i = 0; i < letters.length; i++)
  for (let j = i + 1; j < letters.length; j++) pairs.push({ a: letters[i].id, b: letters[j].id, d: dist(letters[i].proto, letters[j].proto) });
pairs.sort((x, y) => x.d - y.d);
console.log('pares más parecidos:', pairs.slice(0, 12).map((p) => `${p.a}-${p.b}:${p.d.toFixed(2)}`).join('  '));

// ---------------------------------------------------------------------------
// 5) Calibrar umbrales DTW con el propio video (pasada normal y espejada)
/** Mejor costo DTW aceptable (mismas reglas que el juego) al deslizar "ahora" por el tramo. */
function dtwOverSegment(l: LetterRef, fr: LF[]): number {
  const tpl = l.template!;
  const frames = fr.map((f) => ({ t: f.t, f: f.f as HandFeatures | null }));
  let best = Infinity;
  for (let i = 0; i < fr.length; i++) {
    const m = bestDynamicMatch(frames, fr[i].t, tpl, (a, b) => dist(a, b) / l.threshold, { maxWindow: 3.2, minCoverage: 0.6 });
    if (!m || !dynamicAccepted(m, Infinity)) continue;
    best = Math.min(best, m.cost);
  }
  return best;
}
for (const l of letters.filter((x) => x.tipo === 'dinamica')) {
  const win = templateWin.get(l.id)!;
  const proto = protos.get(l.id)!.proto;
  // Casos propios que NO son la plantilla: los otros movimientos de la letra en
  // el video y todos los de la pasada espejada (MediaPipe da otro ruido).
  const ownCases: number[] = [];
  const around = (fr: LF[], e: MoveEvent) => fr.filter((f) => f.t >= e.from.t1 - 0.6 && f.t <= e.to.t0 + 0.6);
  for (const e of validEvents(framesA.get(l.id)!, proto)) {
    if (Math.abs(e.from.t1 - 0.12 - win[0]) < 0.3) continue; // es la plantilla
    ownCases.push(dtwOverSegment(l, around(framesA.get(l.id)!, e)));
  }
  if (framesB) {
    for (const e of validEvents(framesB.get(l.id)!, proto)) ownCases.push(dtwOverSegment(l, around(framesB.get(l.id)!, e)));
  }
  const others: { id: string; c: number }[] = [];
  for (const o of letters) {
    if (o.id === l.id) continue;
    const c = Math.min(dtwOverSegment(l, framesA.get(o.id)!), framesB ? dtwOverSegment(l, framesB.get(o.id)!) : Infinity);
    others.push({ id: o.id, c });
  }
  others.sort((a, b) => a.c - b.c);
  const finite = ownCases.filter(Number.isFinite);
  const ownMax = finite.length ? Math.max(...finite) : 0.5;
  const otherMin = others[0].c;
  // margen para otras personas, sin acercarse demasiado a lo ajeno
  let thr = Math.max(ownMax * 2, 0.8);
  if (Number.isFinite(otherMin)) thr = Math.min(thr, otherMin * 0.75);
  if (thr < ownMax * 1.05) {
    console.warn(`⚠ DTW ${l.id}: poco margen (propio ${ownMax.toFixed(2)} vs ajeno ${otherMin.toFixed(2)})`);
    thr = (ownMax * 1.05 + otherMin * 0.9) / 2;
  }
  l.dynThreshold = round(thr);
  console.log(
    `DTW ${l.id}: propios=${ownCases.map((c) => c.toFixed(2)).join('/')} ajenos más bajos=${others
      .slice(0, 3)
      .map((o) => `${o.id}:${o.c.toFixed(2)}`)
      .join(' ')} → umbral ${l.dynThreshold.toFixed(2)}`,
  );
}

// ---------------------------------------------------------------------------
const reference: AlphabetReference = {
  version: 1,
  generatedAt: new Date().toISOString(),
  refLabel: majorityLabel(rawA),
  scales: Object.fromEntries(Object.entries(SCALES).map(([k, v]) => [k, round(v)])) as any,
  weights: WEIGHTS,
  letters,
};

function majorityLabel(raw: RawFile): 'Left' | 'Right' {
  let r = 0;
  let n = 0;
  for (const f of raw.frames) {
    const h = activeHand(f);
    if (!h) continue;
    n++;
    if (h.label === 'Right') r++;
  }
  console.log(`etiqueta de mano (pasada normal): Right=${((r / n) * 100).toFixed(1)}% de ${n}`);
  return r * 2 >= n ? 'Right' : 'Left';
}
if (rawB) {
  let r = 0;
  let n = 0;
  for (const f of rawB.frames) {
    const h = activeHand(f);
    if (!h) continue;
    n++;
    if (h.label === 'Right') r++;
  }
  console.log(`etiqueta de mano (pasada espejada): Right=${((r / n) * 100).toFixed(1)}% de ${n}`);
}

writeFileSync(join(ROOT, 'src', 'data', 'alphabet_reference.json'), JSON.stringify(reference));
console.log(`\n✔ src/data/alphabet_reference.json (${letters.length} letras, ${letters.filter((l) => l.tipo === 'dinamica').length} dinámicas)`);

// segments.json para la página de revisión y el simulador
for (const s of segs) {
  const l = letters.find((x) => x.id === s.letter)!;
  const { used } = protos.get(s.letter)!;
  const mid = used[Math.floor(used.length / 2)];
  const rawFrame = mid ? rawA.frames.find((f) => f.t === mid.t) : undefined;
  const warn =
    used.length < 10
      ? 'pocos frames'
      : l.tipo === 'estatica' && l.stats.nearest.d < 0.2
        ? `muy parecida a ${l.stats.nearest.id}`
        : undefined;
  segReport.push({
    ...s,
    tipo: l.tipo,
    n: used.length,
    motion: l.stats.motion,
    holdStart: used.length ? Math.min(...used.map((f) => f.t)) : undefined,
    holdEnd: used.length ? Math.max(...used.map((f) => f.t)) : undefined,
    sampleT: mid?.t,
    sampleHand: rawFrame ? activeHand(rawFrame) : undefined,
    warn,
  });
}
writeFileSync(join(OUT, 'segments.json'), JSON.stringify({ segments: segReport }, null, 1));
console.log('✔ tools/extractor/out/segments.json');
