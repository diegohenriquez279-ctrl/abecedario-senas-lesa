/** Utilidades compartidas por buildReference y la evaluación offline (Node). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameObs, HandObs } from '../../src/vision/types';

export interface RawFrame extends FrameObs {
  roi: number;
  ink: number;
}

export interface RawFile {
  video: { w: number; h: number; duration: number };
  mirrored: boolean;
  frames: RawFrame[];
}

export const ROOT = join(import.meta.dirname, '..', '..');
export const OUT = join(ROOT, 'tools', 'extractor', 'out');

export function loadRaw(name: string): RawFile {
  return JSON.parse(readFileSync(join(OUT, name), 'utf8'));
}

/** La mano que está haciendo la seña: la más alta si hay dos. */
export function activeHand(f: FrameObs): HandObs | null {
  let hand: HandObs | null = null;
  for (const h of f.hands) if (!hand || h.lm[0][1] < hand.lm[0][1]) hand = h;
  return hand;
}

export interface Segment {
  letter: string;
  start: number;
  end: number;
}
