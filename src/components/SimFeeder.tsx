import { useEffect, useRef } from 'react';
import type { HandObs } from '../vision/types';
import type { CameraStatus } from './CameraView';
import { drawHandsOnCanvas } from './drawHands';

/**
 * SOLO DESARROLLO (?sim o ?sim=mirror / ?sim=normal / ?sim=wrong): reemplaza la
 * cámara por los landmarks grabados del video de referencia para la letra
 * objetivo, reproducidos en tiempo real. Permite probar el juego completo sin
 * cámara. En producción este componente no se incluye.
 */
interface Props {
  target: string;
  onHands: (t: number, hands: HandObs[]) => void;
  onStatus: (s: CameraStatus) => void;
}

type Raw = { frames: { t: number; hands: HandObs[] }[] };
type Seg = { segments: { letter: string; start: number; end: number }[] };
let cache: Promise<[Raw, Seg]> | null = null;

export function SimFeeder({ target, onHands, onStatus }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cb = useRef(onHands);
  cb.current = onHands;

  useEffect(() => {
    const mode = new URLSearchParams(location.search).get('sim') || 'mirror';
    const file = mode === 'normal' ? 'raw_frames.json' : 'raw_frames_mirror.json';
    cache ??= Promise.all([
      fetch(`/tools/extractor/out/${file}`).then((r) => r.json()),
      fetch('/tools/extractor/out/segments.json').then((r) => r.json()),
    ]);
    let stop = false;
    let timer = 0;
    onStatus('iniciando');
    cache.then(([raw, seg]) => {
      if (stop) return;
      const letters = seg.segments.map((s) => s.letter);
      // ?sim=wrong reproduce otra letra (para comprobar que NO valida)
      const src = mode === 'wrong' ? letters[(letters.indexOf(target) + 7) % letters.length] : target;
      const s = seg.segments.find((x) => x.letter === src)!;
      const frames = raw.frames.filter((f) => f.t >= s.start && f.t < s.end);
      onStatus('lista');
      const t0 = performance.now() / 1000;
      const dur = s.end - s.start;
      let i = 0;
      const canvas = canvasRef.current!;
      canvas.width = 480;
      canvas.height = 480;
      const tick = () => {
        if (stop) return;
        const el = (performance.now() / 1000 - t0) % dur;
        const want = s.start + el;
        // avanzar hasta el frame correspondiente al tiempo actual (con vuelta)
        if (frames[i] && frames[i].t > want + 0.2) i = 0;
        while (i < frames.length - 1 && frames[i + 1].t <= want) i++;
        const f = frames[i];
        if (f) {
          drawHandsOnCanvas(canvas, f.hands, 'neutral');
          cb.current(performance.now() / 1000, f.hands);
        }
        timer = window.setTimeout(tick, 1000 / 15);
      };
      tick();
    });
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [target, onStatus]);

  return (
    <div className="cam cam-sim">
      <canvas ref={canvasRef} className="cam-overlay" />
      <span className="sim-tag">SIMULACIÓN</span>
    </div>
  );
}
