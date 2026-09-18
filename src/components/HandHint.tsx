import { useEffect, useMemo, useState } from 'react';
import type { LetterRef } from '../recognizer/types';
import { BONES } from './drawHands';

interface Props {
  letter: LetterRef;
  /** espejar el dibujo (para que coincida con la vista en espejo de la cámara) */
  flipX: boolean;
  size?: number;
}

const FINGER_CHAINS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];
const PALM = [0, 1, 5, 9, 13, 17];
const MOVE_SCALE = 0.5;

type Pts = [number, number][];

function toPts(disp: number[], flip: boolean): Pts {
  const out: Pts = [];
  for (let i = 0; i < disp.length; i += 2) out.push([flip ? -disp[i] : disp[i], disp[i + 1]]);
  return out;
}

/**
 * Diagrama original de la seña, dibujado a partir del esqueleto de 21 puntos
 * del prototipo (no usa imágenes ni video). Las dinámicas se animan.
 */
export function HandHint({ letter, flipX, size = 150 }: Props) {
  const tpl = letter.tipo === 'dinamica' ? letter.template : undefined;
  // En las dinámicas el desplazamiento de la mano se achica en el dibujo (solo
  // visual) para que la forma de la mano no quede diminuta junto al recorrido.
  const frames = useMemo<Pts[]>(() => {
    if (!tpl) return [toPts(letter.disp, flipX)];
    return tpl.disp.map((d) => {
      const pts = toPts(d, flipX);
      const [wx, wy] = pts[0];
      return pts.map(([x, y]) => [x - wx * (1 - MOVE_SCALE), y - wy * (1 - MOVE_SCALE)] as [number, number]);
    });
  }, [tpl, letter.disp, flipX]);
  const path = useMemo<Pts>(() => (tpl ? frames.map((f) => f[tpl.keyPoint]) : []), [tpl, frames]);

  // caja que contiene todos los frames (y la trayectoria)
  const box = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const f of [...frames, path]) {
      for (const [x, y] of f) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    const pad = 0.35;
    const w = maxX - minX;
    const h = maxY - minY;
    const s = Math.max(w, h) + pad * 2;
    return { x: (minX + maxX) / 2 - s / 2, y: (minY + maxY) / 2 - s / 2, s };
  }, [frames, path]);

  const [k, setK] = useState(0);
  useEffect(() => {
    if (frames.length < 2) return;
    setK(0);
    const dur = Math.max(0.8, tpl?.duration ?? 1) * 1000;
    const pause = 700;
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const cyc = (now - t0) % (dur + pause * 2);
      const u = Math.min(1, Math.max(0, (cyc - pause) / dur));
      setK(Math.round(u * (frames.length - 1)));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [frames, tpl]);

  const pts = frames[Math.min(k, frames.length - 1)];
  const sw = box.s / 30;
  const line = (a: [number, number], b: [number, number]) => `M${a[0]},${a[1]} L${b[0]},${b[1]}`;

  return (
    <svg
      className="hand-hint"
      width={size}
      height={size}
      viewBox={`${box.x} ${box.y} ${box.s} ${box.s}`}
      role="img"
      aria-label={`Forma de la mano para la letra ${letter.id}`}
    >
      {path.length > 1 && (
        <>
          <path
            d={'M' + path.map((p) => p.join(',')).join(' L')}
            className="hint-path"
            strokeWidth={sw * 0.6}
            strokeDasharray={`${sw * 1.2} ${sw}`}
            fill="none"
          />
          <circle cx={path[path.length - 1][0]} cy={path[path.length - 1][1]} r={sw * 0.9} className="hint-path-end" />
        </>
      )}
      <polygon points={PALM.map((i) => pts[i].join(',')).join(' ')} className="hint-palm" />
      {BONES.filter(([a, b]) => PALM.includes(a) && PALM.includes(b)).map(([a, b]) => (
        <path key={`p${a}-${b}`} d={line(pts[a], pts[b])} className="hint-bone-palm" strokeWidth={sw * 0.7} />
      ))}
      {FINGER_CHAINS.map((chain, fi) => (
        <path
          key={fi}
          d={'M' + [chain[0] === 1 ? 0 : chain[0], ...chain].map((i) => pts[i].join(',')).join(' L')}
          className={fi === 0 ? 'hint-finger hint-thumb' : 'hint-finger'}
          strokeWidth={sw * 1.6}
          fill="none"
        />
      ))}
      {[4, 8, 12, 16, 20].map((i) => (
        <circle key={i} cx={pts[i][0]} cy={pts[i][1]} r={sw * 0.9} className="hint-tip" />
      ))}
    </svg>
  );
}
