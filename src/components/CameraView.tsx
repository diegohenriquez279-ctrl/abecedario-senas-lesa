import { useEffect, useRef, useState } from 'react';
import { visionEngine } from '../vision/engine';
import type { HandObs } from '../vision/types';
import { drawHandsOnCanvas } from './drawHands';

export type CameraStatus = 'iniciando' | 'lista' | 'error';

interface Props {
  /** se llama con cada frame analizado (t en segundos) */
  onHands: (t: number, hands: HandObs[]) => void;
  onStatus?: (s: CameraStatus, message?: string) => void;
  /** color del esqueleto dibujado sobre la mano */
  tone?: 'neutral' | 'ok';
}

let sharedStream: MediaStream | null = null;
// Promesa en curso: evita pedir la cámara dos veces a la vez (p. ej. el doble
// montaje de StrictMode), lo que dejaría un stream huérfano con la cámara prendida.
let pending: Promise<MediaStream> | null = null;
let generation = 0;

function getStream(): Promise<MediaStream> {
  if (sharedStream && sharedStream.getVideoTracks().some((t) => t.readyState === 'live')) return Promise.resolve(sharedStream);
  if (!window.isSecureContext) return Promise.reject(new Error('inseguro'));
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error('sin-api'));
  if (!pending) {
    const gen = generation;
    pending = navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      })
      .then((s) => {
        if (gen !== generation) {
          // se pidió apagar la cámara mientras se abría
          s.getTracks().forEach((t) => t.stop());
          throw new Error('cancelada');
        }
        sharedStream = s;
        return s;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** Apaga la cámara (al salir o al terminar la ronda). */
export function stopCamera() {
  generation++;
  sharedStream?.getTracks().forEach((t) => t.stop());
  sharedStream = null;
}

function explain(err: unknown): string {
  const e = err as { name?: string; message?: string };
  if (e?.message === 'inseguro') return 'La cámara necesita una conexión segura (https o localhost).';
  if (e?.message === 'sin-api') return 'Este navegador no permite usar la cámara.';
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError')
    return 'No tenemos permiso para usar la cámara. Habilitalo en el navegador y volvé a intentar.';
  if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') return 'No encontramos una cámara en este dispositivo.';
  if (e?.name === 'NotReadableError') return 'La cámara está en uso por otra aplicación. Cerrala y volvé a intentar.';
  return 'No pudimos iniciar la cámara o el detector de manos. Probá recargar la página.';
}

/** Vista de cámara en espejo, con el esqueleto de la mano dibujado encima. */
export function CameraView({ onHands, onStatus, tone = 'neutral' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onHandsRef = useRef(onHands);
  const toneRef = useRef(tone);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  onHandsRef.current = onHands;
  toneRef.current = tone;

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let lastVideoTime = -1;
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    setError(null);
    onStatus?.('iniciando');

    (async () => {
      try {
        const [stream] = await Promise.all([getStream(), visionEngine.load()]);
        if (cancelled) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        onStatus?.('lista');
        // En equipos lentos se espacian las detecciones según lo que tarda
        // cada una (evita trabar la interfaz y ahorra batería).
        let nextAt = 0;
        const loop = () => {
          if (cancelled) return;
          raf = requestAnimationFrame(loop);
          if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
          const t0 = performance.now();
          if (t0 < nextAt) return;
          lastVideoTime = video.currentTime;
          const hands = visionEngine.detect(video);
          const took = performance.now() - t0;
          nextAt = t0 + (took > 30 ? Math.min(120, took * 1.5) : 0);
          if (canvas.width !== video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          drawHandsOnCanvas(canvas, hands, toneRef.current);
          onHandsRef.current(performance.now() / 1000, hands);
        };
        loop();
      } catch (err) {
        if (cancelled || (err as Error)?.message === 'cancelada') return;
        console.error(err);
        const msg = explain(err);
        setError(msg);
        onStatus?.('error', msg);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return (
    <div className="cam">
      <video ref={videoRef} className="cam-video" playsInline muted autoPlay />
      <canvas ref={canvasRef} className="cam-overlay" />
      {error && (
        <div className="cam-error" role="alert">
          <p>{error}</p>
          <button className="btn btn-secondary" onClick={() => setAttempt((a) => a + 1)}>
            Reintentar cámara
          </button>
        </div>
      )}
    </div>
  );
}
