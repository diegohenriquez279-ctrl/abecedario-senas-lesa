/**
 * Herramienta interna (NO se despliega): recorre el video de referencia,
 * corre HandLandmarker frame a frame y guarda los landmarks crudos + la señal
 * de cambio de la zona donde aparece la letra escrita. Después
 * `npm run build:reference` segmenta por letra y genera
 * src/data/alphabet_reference.json. Esta página también permite revisar la
 * segmentación (una tarjeta por letra con el frame central y el esqueleto).
 */
import { createHandLandmarker, toHandObs } from '../../src/vision/handTracker';
import type { HandObs } from '../../src/vision/types';
import { LETTERS } from '../../src/data/letters';
import { decodeAll } from './decode';

// Recorte cuadrado alrededor del firmante (fracciones del frame). La mano
// ocupa más píxeles del modelo que con el frame 16:9 entero.
const CROP = { x: 0.25, y: 0, w: 0.5, h: 0.889 };
// Zona de la letra escrita (abajo a la izquierda), en fracciones del frame.
// Arranca alto para incluir la tilde de la Ñ.
const ROI = { x: 0, y: 0.52, w: 0.26, h: 0.46 };
const ROI_W = 40;
const ROI_H = 24;

interface RawFrame {
  t: number;
  roi: number; // diferencia media con el frame anterior (0..255)
  ink: number; // fracción de píxeles muy claros (la letra es blanca)
  hands: HandObs[];
}

const app = document.getElementById('app')!;
app.innerHTML = `
  <h1>Extractor LESA <small>(herramienta interna — no se despliega)</small></h1>
  <p>Video de referencia: <input type="file" id="file" accept="video/*" />
     <span id="src">usando /El_abecedario_lessa.mp4 (servido por el dev server)</span></p>
  <div class="row">
    <button id="run">1. Extraer landmarks (reproduce el video completo)</button>
    <label><input type="checkbox" id="mirror" checked /> también pasada espejada (prueba mano izquierda)</label>
    <label><input type="checkbox" id="full" /> validación: cuadro completo 16:9 sin recorte (→ raw_frames_full.json)</label>
    <button id="review">2. Revisar segmentación</button>
  </div>
  <div class="row">
    <canvas id="view" width="480" height="480"></canvas>
    <div class="log" id="log" style="flex:1;min-width:280px"></div>
  </div>
  <div id="cards" class="grid"></div>
  <video id="v" src="/El_abecedario_lessa.mp4" muted playsinline preload="auto" style="position:fixed;right:8px;bottom:8px;width:160px;opacity:0.9"></video>`;

const v = document.getElementById('v') as HTMLVideoElement;
const view = document.getElementById('view') as HTMLCanvasElement;
const logEl = document.getElementById('log')!;
const log = (s: string) => {
  logEl.textContent += s + '\n';
  logEl.scrollTop = logEl.scrollHeight;
};
(window as any).v = v;

document.getElementById('file')!.addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  v.src = URL.createObjectURL(f);
  document.getElementById('src')!.textContent = f.name;
});

const round = (x: number, d: number) => Math.round(x * d) / d;
function packHands(hands: HandObs[]): HandObs[] {
  return hands.map((h) => ({
    label: h.label,
    score: round(h.score, 1000),
    lm: h.lm.map((p) => p.map((c) => round(c, 1e4)) as any),
    wl: h.wl.map((p) => p.map((c) => round(c, 1e5)) as any),
  }));
}

function drawHands(g: CanvasRenderingContext2D, hands: HandObs[], size: number, color: string) {
  const bones = [
    [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
    [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
  ];
  g.strokeStyle = color;
  g.lineWidth = 2;
  for (const h of hands) {
    for (const [a, b] of bones) {
      g.beginPath();
      g.moveTo(h.lm[a][0] * size, h.lm[a][1] * size);
      g.lineTo(h.lm[b][0] * size, h.lm[b][1] * size);
      g.stroke();
    }
  }
}

async function save(file: string, data: unknown) {
  const res = await fetch(`/__save?file=${encodeURIComponent(file)}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
}

let running = false;
document.getElementById('run')!.addEventListener('click', async () => {
  if (running) return;
  running = true;
  const full = (document.getElementById('full') as HTMLInputElement).checked;
  const doMirror = !full && (document.getElementById('mirror') as HTMLInputElement).checked;
  try {
    await extract(doMirror, full);
  } catch (e) {
    log('ERROR: ' + (e as Error).message);
    console.error(e);
  }
  running = false;
});

async function extract(doMirror: boolean, full = false) {
  log('cargando modelos…');
  const hlA = await createHandLandmarker('/models', 2);
  const hlB = doMirror ? await createHandLandmarker('/models', 2) : null;
  if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
  const W = v.videoWidth;
  const H = v.videoHeight;
  // full = cuadro completo (como una cámara 16:9): valida la corrección de aspecto
  const cx = full ? 0 : Math.round(CROP.x * W);
  const cy = full ? 0 : Math.round(CROP.y * H);
  const cw = full ? W : Math.round(CROP.w * W);
  const ch = full ? H : Math.round(CROP.h * H);
  const cropAspect = cw / ch;
  const S = full ? 853 : 480;
  const cA = document.createElement('canvas');
  cA.width = S;
  cA.height = Math.round(S / cropAspect);
  const cB = document.createElement('canvas');
  cB.width = cA.width;
  cB.height = cA.height;
  const gA = cA.getContext('2d', { willReadFrequently: false })!;
  const gB = cB.getContext('2d')!;
  const roiC = document.createElement('canvas');
  roiC.width = ROI_W;
  roiC.height = ROI_H;
  const gR = roiC.getContext('2d', { willReadFrequently: true })!;
  const gv = view.getContext('2d')!;

  const framesA: RawFrame[] = [];
  const framesB: RawFrame[] = [];
  let prevRoi: Uint8ClampedArray | null = null;
  let lastTs = -1;
  log(`video ${W}x${H}, ${v.duration.toFixed(1)} s — decodificando con WebCodecs…`);

  // Se decodifica el archivo completo con WebCodecs (determinista y sin depender
  // de la reproducción en tiempo real). Se analiza 1 de cada STEP frames.
  // El video de referencia es de 60 fps: 1 de cada 4 = 15 fps analizados.
  const STEP = 4;
  let idx = 0;
  const onFrame = (frame: VideoFrame) => {
    const t = frame.timestamp / 1e6;
    if (idx++ % STEP !== 0) return;
    {
      const ts = Math.max(lastTs + 1, Math.round(t * 1000));
      lastTs = ts;

      // zona de la letra
      gR.drawImage(frame, ROI.x * W, ROI.y * H, ROI.w * W, ROI.h * H, 0, 0, ROI_W, ROI_H);
      const px = gR.getImageData(0, 0, ROI_W, ROI_H).data;
      let diff = 0;
      let ink = 0;
      const gray = new Uint8ClampedArray(ROI_W * ROI_H);
      for (let i = 0; i < gray.length; i++) {
        const gval = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
        gray[i] = gval;
        if (gval > 235) ink++;
        if (prevRoi) diff += Math.abs(gval - prevRoi[i]);
      }
      prevRoi = gray;
      const roi = round(diff / gray.length, 100);
      const inkF = round(ink / gray.length, 1000);

      gA.drawImage(frame, cx, cy, cw, ch, 0, 0, cA.width, cA.height);
      const hA = toHandObs(hlA.detectForVideo(cA, ts), cropAspect);
      framesA.push({ t: round(t, 1000), roi, ink: inkF, hands: packHands(hA) });

      gv.drawImage(cA, 0, 0, view.width, view.height);
      drawHands(gv, hA, view.height, '#0f0');

      if (hlB) {
        gB.setTransform(-1, 0, 0, 1, cB.width, 0);
        gB.drawImage(frame, cx, cy, cw, ch, 0, 0, cB.width, cB.height);
        const hB = toHandObs(hlB.detectForVideo(cB, ts), cropAspect);
        framesB.push({ t: round(t, 1000), roi, ink: inkF, hands: packHands(hB) });
      }

      if (framesA.length % 150 === 0) {
        const det = framesA.filter((f) => f.hands.length).length;
        log(`t=${t.toFixed(1)}s frames=${framesA.length} con mano=${det}`);
      }
    }
  };
  const buf = await (await fetch(v.currentSrc || v.src)).arrayBuffer();
  await decodeAll(buf, onFrame);

  const meta = { video: { w: W, h: H, duration: v.duration }, crop: CROP, roiBox: ROI };
  log(`fin: ${framesA.length} frames. Guardando…`);
  await save(full ? 'tools/extractor/out/raw_frames_full.json' : 'tools/extractor/out/raw_frames.json', {
    ...meta,
    crop: full ? { x: 0, y: 0, w: 1, h: 1 } : CROP,
    mirrored: false,
    frames: framesA,
  });
  if (hlB) await save('tools/extractor/out/raw_frames_mirror.json', { ...meta, mirrored: true, frames: framesB });
  log('guardado en tools/extractor/out/. Ahora corré: npm run build:reference');
  hlA.close();
  hlB?.close();
}

// ---------------------------------------------------------------------------
// Revisión: una tarjeta por letra con el frame central del hold y el esqueleto
document.getElementById('review')!.addEventListener('click', async () => {
  const cards = document.getElementById('cards')!;
  cards.innerHTML = '';
  let seg: any;
  try {
    seg = await (await fetch('/tools/extractor/out/segments.json?' + Date.now())).json();
  } catch {
    log('No hay segments.json: corré primero npm run build:reference');
    return;
  }
  if (v.readyState < 1) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
  const W = v.videoWidth;
  const H = v.videoHeight;
  for (const s of seg.segments) {
    const card = document.createElement('div');
    card.className = 'card' + (s.tipo === 'dinamica' ? ' dyn' : '') + (s.warn ? ' warn' : '');
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 320;
    card.appendChild(c);
    const p = document.createElement('div');
    p.textContent = `${s.letter} [${s.start.toFixed(1)}–${s.end.toFixed(1)}] hold ${s.holdStart?.toFixed(1)}–${s.holdEnd?.toFixed(1)} n=${s.n} mov=${s.motion?.toFixed(2)} ${s.tipo}${s.warn ? ' ⚠ ' + s.warn : ''}`;
    card.appendChild(p);
    cards.appendChild(card);
    const t = s.sampleT ?? (s.start + s.end) / 2;
    v.currentTime = t;
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    const g = c.getContext('2d')!;
    g.drawImage(v, CROP.x * W, CROP.y * H, CROP.w * W, CROP.h * H, 0, 0, 320, 320 / ((CROP.w * W) / (CROP.h * H)));
    // letra escrita (miniatura) para confirmar la segmentación
    g.drawImage(v, ROI.x * W, ROI.y * H, ROI.w * W, ROI.h * H, 0, 240, 107, 80);
    if (s.sampleHand) drawHands(g, [s.sampleHand], 320, '#0f0');
  }
  log(`revisión: ${seg.segments.length} letras (naranja = dinámica, rojo = revisar)`);
});

log(`Letras esperadas (${LETTERS.length}): ${LETTERS.map((l) => l.id).join(' ')}`);
