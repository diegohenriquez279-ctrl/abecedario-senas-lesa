import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CONFIG } from '../config';
import type { Evaluation, Recognizer } from '../recognizer/recognizer';
import type { HandObs } from '../vision/types';
import { CameraView, type CameraStatus } from './CameraView';
import { HandHint } from './HandHint';
import { SimFeeder } from './SimFeeder';

interface Props {
  recognizer: Recognizer;
  target: string;
  /** true mientras se muestra el festejo (no se evalúa) */
  paused: boolean;
  onSuccess: () => void;
  onCameraStatus?: (s: CameraStatus) => void;
  /** contenido extra debajo del feedback (botones) */
  children?: ReactNode;
}

const SIM = import.meta.env.DEV && new URLSearchParams(location.search).has('sim');
/** ?debug muestra las letras más cercanas con su distancia/umbral (para calibrar). */
const DEBUG = new URLSearchParams(location.search).has('debug');

const IDLE: Evaluation = {
  status: 'no-hand',
  progress: 0,
  closeness: Infinity,
  looksLike: null,
  hints: [],
  mirroredHand: false,
};

export function SignTrainer({ recognizer, target, paused, onSuccess, onCameraStatus, children }: Props) {
  const [ev, setEv] = useState<Evaluation>(IDLE);
  const [camStatus, setCamStatus] = useState<CameraStatus>('iniciando');
  const [debug, setDebug] = useState('');
  const successRef = useRef(onSuccess);
  successRef.current = onSuccess;
  const letter = recognizer.letter(target)!;

  // nueva letra: limpiar el buffer para no arrastrar la seña anterior
  useEffect(() => {
    recognizer.reset();
    setEv(IDLE);
  }, [target, recognizer]);

  const onHands = useCallback((t: number, hands: HandObs[]) => recognizer.push(t, hands), [recognizer]);

  useEffect(() => {
    if (paused || camStatus !== 'lista') return;
    const id = setInterval(() => {
      const now = performance.now() / 1000;
      const e = recognizer.evaluate(target, now);
      setEv(e);
      if (DEBUG) {
        const r = recognizer.debugRanking(now).slice(0, 4);
        setDebug(
          `${e.status} c=${e.closeness.toFixed(2)} | ` + r.map((x) => `${x.id}:${x.d.toFixed(1)}/${x.thr.toFixed(1)}`).join(' '),
        );
      }
      if (e.status === 'ok') successRef.current();
    }, CONFIG.evalIntervalMs);
    return () => clearInterval(id);
  }, [paused, camStatus, target, recognizer]);

  const handleStatus = useCallback(
    (s: CameraStatus) => {
      setCamStatus(s);
      onCameraStatus?.(s);
    },
    [onCameraStatus],
  );

  const message = paused
    ? '¡Muy bien!'
    : camStatus === 'iniciando'
      ? 'Preparando la cámara…'
      : camStatus === 'error'
        ? ''
        : ev.status === 'no-hand'
          ? 'Mostrá la mano frente a la cámara'
          : ev.status === 'ok'
            ? '¡Muy bien!'
            : ev.hints[0] ?? 'Sostené la seña';
  const extra = !paused && ev.status !== 'no-hand' ? ev.hints.slice(1) : [];
  const good = paused || ev.status === 'ok';

  return (
    <div className="trainer">
      <section className="target" aria-live="polite">
        <div className="target-letter" aria-label={`Letra ${target}`}>
          {target}
          {letter.tipo === 'dinamica' && <span className="badge">con movimiento</span>}
        </div>
        <figure className="target-hint">
          <HandHint letter={letter} flipX={!ev.mirroredHand} />
          <figcaption>Así se ve en tu cámara</figcaption>
        </figure>
      </section>

      <div className={`cam-wrap ${good ? 'cam-good' : ''}`}>
        {SIM ? (
          <SimFeeder target={target} onHands={onHands} onStatus={handleStatus} />
        ) : (
          <CameraView onHands={onHands} onStatus={handleStatus} tone={good ? 'ok' : 'neutral'} />
        )}
        <div className="progress" aria-hidden="true">
          <div className="progress-fill" style={{ width: `${(good ? 1 : ev.progress) * 100}%` }} />
        </div>
        {good && <div className="cam-check" aria-hidden="true">✓</div>}
      </div>

      <div className={`feedback ${good ? 'feedback-ok' : ''}`} role="status">
        <p className="feedback-main">{message}</p>
        {extra.map((h) => (
          <p key={h} className="feedback-extra">
            {h}
          </p>
        ))}
      </div>
      {DEBUG && <pre className="debug">{debug}</pre>}
      {children}
    </div>
  );
}
