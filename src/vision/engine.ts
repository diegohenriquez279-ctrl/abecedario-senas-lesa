import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { createHandLandmarker, toHandObs } from './handTracker';
import type { HandObs } from './types';

/**
 * Motor de visión del juego: un único HandLandmarker compartido, con
 * timestamps estrictamente crecientes y recreación automática si el grafo de
 * MediaPipe falla. Todo se procesa en el dispositivo.
 */
class VisionEngine {
  private landmarker: HandLandmarker | null = null;
  private loading: Promise<HandLandmarker> | null = null;
  private lastTs = 0;
  private failures = 0;

  load(): Promise<HandLandmarker> {
    if (this.landmarker) return Promise.resolve(this.landmarker);
    if (!this.loading) {
      this.loading = createHandLandmarker(`${import.meta.env.BASE_URL}models`, 2)
        .then((l) => {
          this.landmarker = l;
          return l;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  get ready() {
    return !!this.landmarker;
  }

  /** Detecta manos en el frame actual. Devuelve [] si no está listo o si falló. */
  detect(source: HTMLVideoElement | HTMLCanvasElement): HandObs[] {
    const l = this.landmarker;
    if (!l) return [];
    const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (!w || !h) return [];
    const ts = Math.max(this.lastTs + 1, Math.round(performance.now()));
    this.lastTs = ts;
    try {
      const res = l.detectForVideo(source, ts);
      this.failures = 0;
      return toHandObs(res, w / h);
    } catch (err) {
      console.warn('Fallo de detección; se recrea el modelo', err);
      this.failures++;
      this.landmarker = null;
      try {
        l.close();
      } catch {
        /* ignorar */
      }
      if (this.failures < 5) void this.load();
      return [];
    }
  }
}

export const visionEngine = new VisionEngine();
