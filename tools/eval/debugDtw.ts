/**
 * Diagnóstico: mejor coincidencia (mismas reglas que el juego) de la plantilla
 * de una letra dinámica dentro del tramo de otra letra.
 *   npx tsx tools/eval/debugDtw.ts RR R
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { protoDistance, toProto } from '../../src/recognizer/distance';
import { bestDynamicMatch, dynamicAccepted, trajectoryOf } from '../../src/recognizer/dtw';
import type { AlphabetReference } from '../../src/recognizer/types';
import { extractFeatures } from '../../src/vision/features';
import { activeHand, loadRaw, OUT, ROOT } from '../extractor/common';

const [target, segLetter] = process.argv.slice(2);
const ref: AlphabetReference = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'alphabet_reference.json'), 'utf8'));
const segs = JSON.parse(readFileSync(join(OUT, 'segments.json'), 'utf8')).segments;
const l = ref.letters.find((x) => x.id === target)!;
const tpl = l.template!;
const s = segs.find((x: { letter: string }) => x.letter === segLetter);
const raw = loadRaw('raw_frames.json');
const frames = raw.frames
  .filter((f) => f.t >= s.start && f.t < s.end)
  .map((f) => {
    const h = activeHand(f);
    return { t: f.t, f: h ? extractFeatures(h, false) : null };
  });
let best: { t: number; m: NonNullable<ReturnType<typeof bestDynamicMatch>> } | null = null;
for (const fr of frames) {
  const m = bestDynamicMatch(frames, fr.t, tpl, (a, b) => protoDistance(toProto(a), b, ref.scales, ref.weights) / l.threshold, {
    maxWindow: 3.2,
    minCoverage: 0.6,
  });
  if (!m || !dynamicAccepted(m, Infinity)) continue;
  if (!best || m.cost < best.m.cost) best = { t: fr.t, m };
}
if (!best) {
  console.log('sin coincidencias aceptables');
} else {
  const m = best.m;
  console.log(
    `${target} en tramo ${segLetter}: costo=${m.cost.toFixed(2)} (umbral ${l.dynThreshold}) forma=${m.shapeCost.toFixed(2)} tray=${m.trajCost.toFixed(2)} ext=${m.extentRatio.toFixed(2)} fin en t=${best.t}`,
  );
  console.log('usuario  :', trajectoryOf(m.seq, tpl.keyPoint).map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' '));
  console.log('plantilla:', tpl.frames.map((f) => f.tr.map((v) => v.toFixed(1)).join(',')).join(' '));
}
