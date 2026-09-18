import { angleBetween, angleDiff } from '../vision/geometry';
import type { Proto } from './types';

const FINGER_NAMES = ['pulgar', 'índice', 'medio', 'anular', 'meñique'];

interface Issue {
  weight: number;
  text: string;
}

function joinNames(names: string[]): string {
  if (names.length === 1) return `el ${names[0]}`;
  const last = names[names.length - 1];
  return names.slice(0, -1).join(', ') + ' y ' + last;
}

/** Hacia dónde apuntan los dedos, en palabras (sin izquierda/derecha para no confundir con el espejo). */
function axisWord(axis: number): string {
  const deg = (axis * 180) / Math.PI; // imagen: -90 = arriba, 90 = abajo
  if (deg < -45 && deg > -135) return 'hacia arriba';
  if (deg > 45 && deg < 135) return 'hacia abajo';
  return 'hacia el costado';
}

/** Hacia dónde mira la palma. normal.z < 0 = hacia la cámara. */
function palmWord(n: [number, number, number]): 'cámara' | 'dorso' | 'costado' | 'abajo' | 'arriba' {
  if (n[2] < -0.55) return 'cámara';
  if (n[2] > 0.55) return 'dorso';
  if (n[1] > 0.6) return 'abajo';
  if (n[1] < -0.6) return 'arriba';
  return 'costado';
}

const PALM_TEXT: Record<ReturnType<typeof palmWord>, string> = {
  cámara: 'Mostrá la palma hacia la cámara',
  dorso: 'Girá la mano: se tiene que ver el dorso',
  costado: 'Poné la mano de costado, como en el dibujo',
  abajo: 'Girá la palma hacia abajo',
  arriba: 'Girá la palma hacia arriba',
};

/**
 * Compara la forma del usuario con la de la letra objetivo y devuelve
 * correcciones cortas y amables, ordenadas por importancia (máx. `max`).
 */
export function describeCorrections(user: Proto, target: Proto, max = 2): string[] {
  const issues: Issue[] = [];

  // Flexión de dedos (índice..meñique)
  const toStretch: string[] = [];
  const toBend: string[] = [];
  let fingerWeight = 0;
  for (let i = 1; i < 5; i++) {
    const d = user.curl[i] - target.curl[i];
    if (d > 0.28) {
      toStretch.push(FINGER_NAMES[i]);
      fingerWeight = Math.max(fingerWeight, d);
    } else if (d < -0.28) {
      toBend.push(FINGER_NAMES[i]);
      fingerWeight = Math.max(fingerWeight, -d);
    }
  }
  if (toStretch.length === 4) issues.push({ weight: fingerWeight + 0.2, text: 'Abrí la mano: estirá los dedos' });
  else if (toStretch.length)
    issues.push({ weight: fingerWeight, text: `Estirá ${joinNames(toStretch)}` });
  if (toBend.length === 4) issues.push({ weight: fingerWeight + 0.2, text: 'Cerrá los dedos' });
  else if (toBend.length) issues.push({ weight: fingerWeight, text: `Doblá ${joinNames(toBend)}` });

  // Pulgar: flexión y posición respecto de la palma
  const tc = user.curl[0] - target.curl[0];
  const tFar = user.thumb[0] - target.thumb[0]; // distancia a la base del índice
  if (tFar > 0.45) issues.push({ weight: tFar * 0.8, text: 'Acercá el pulgar a la mano' });
  else if (tFar < -0.45) issues.push({ weight: -tFar * 0.8, text: 'Separá el pulgar hacia el costado' });
  else if (tc > 0.35) issues.push({ weight: tc * 0.7, text: 'Estirá el pulgar' });
  else if (tc < -0.35) issues.push({ weight: -tc * 0.7, text: 'Doblá el pulgar' });

  // Separación índice-medio
  const sp = user.spread[1] - target.spread[1];
  if (sp > 0.22) issues.push({ weight: sp, text: 'Juntá el índice y el medio' });
  else if (sp < -0.22) issues.push({ weight: -sp, text: 'Separá el índice y el medio' });

  // Orientación de los dedos
  const ad = angleDiff(user.axis, target.axis);
  if (ad > (40 * Math.PI) / 180) {
    issues.push({ weight: ad / 1.6, text: `Girá la mano: los dedos van ${axisWord(target.axis)}` });
  }

  // Hacia dónde mira la palma
  const nd = angleBetween(user.normal, target.normal);
  if (nd > (50 * Math.PI) / 180) {
    const want = palmWord(target.normal);
    const have = palmWord(user.normal);
    if (want !== have) issues.push({ weight: nd / 1.8, text: PALM_TEXT[want] });
  }

  issues.sort((a, b) => b.weight - a.weight);
  return issues.slice(0, max).map((i) => i.text);
}

/** Descripción breve de la forma (para el hint de texto). */
export function describeShape(p: Proto): string {
  const ext = [1, 2, 3, 4].filter((i) => p.curl[i] < 0.35).map((i) => FINGER_NAMES[i]);
  const parts: string[] = [];
  if (ext.length === 0) parts.push('dedos cerrados');
  else if (ext.length === 4) parts.push('cuatro dedos estirados');
  else parts.push(`${ext.join(', ')} estirado${ext.length > 1 ? 's' : ''}`);
  parts.push(`palma: ${palmWord(p.normal)}`);
  return parts.join(' · ');
}
