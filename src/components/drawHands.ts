import type { HandObs } from '../vision/types';

export const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

/** Dibuja las manos detectadas. `lm` trae x escalado por el aspecto, así que x_px = x * alto. */
export function drawHandsOnCanvas(canvas: HTMLCanvasElement, hands: HandObs[], tone: 'neutral' | 'ok') {
  const g = canvas.getContext('2d');
  if (!g) return;
  const H = canvas.height;
  g.clearRect(0, 0, canvas.width, H);
  const color = tone === 'ok' ? '#3ddc84' : '#ffffff';
  g.lineCap = 'round';
  for (const h of hands) {
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = Math.max(4, H / 90);
    for (const [a, b] of BONES) {
      g.beginPath();
      g.moveTo(h.lm[a][0] * H, h.lm[a][1] * H);
      g.lineTo(h.lm[b][0] * H, h.lm[b][1] * H);
      g.stroke();
    }
    g.strokeStyle = color;
    g.lineWidth = Math.max(2, H / 200);
    for (const [a, b] of BONES) {
      g.beginPath();
      g.moveTo(h.lm[a][0] * H, h.lm[a][1] * H);
      g.lineTo(h.lm[b][0] * H, h.lm[b][1] * H);
      g.stroke();
    }
    g.fillStyle = color;
    for (const p of h.lm) {
      g.beginPath();
      g.arc(p[0] * H, p[1] * H, Math.max(2, H / 160), 0, Math.PI * 2);
      g.fill();
    }
  }
}
