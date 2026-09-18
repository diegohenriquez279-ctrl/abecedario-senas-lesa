import { useCallback, useEffect, useRef, type Dispatch } from 'react';
import { CONFIG } from '../config';
import type { GameAction, GameState } from '../game/state';
import type { Recognizer } from '../recognizer/recognizer';
import { SignTrainer } from '../components/SignTrainer';
import { TimerSemaforo } from '../components/TimerSemaforo';
import type { CameraStatus } from '../components/CameraView';

interface Props {
  state: GameState;
  dispatch: Dispatch<GameAction>;
  recognizer: Recognizer;
}

export function Juego({ state, dispatch, recognizer }: Props) {
  const target = state.letters[state.index];
  // El reloj arranca cuando la cámara y el detector están listos (no se
  // descuenta el tiempo de carga).
  const deadline = useRef<number | null>(null);

  const onCameraStatus = useCallback((s: CameraStatus) => {
    if (s === 'lista' && deadline.current === null) {
      deadline.current = performance.now() + CONFIG.roundSeconds * 1000;
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (deadline.current === null) return;
      dispatch({ type: 'tick', timeLeft: (deadline.current - performance.now()) / 1000 });
    }, 200);
    return () => clearInterval(id);
  }, [dispatch]);

  // Tras validar, una pausa corta de festejo y a la siguiente letra.
  useEffect(() => {
    if (!state.celebrating) return;
    const id = setTimeout(() => dispatch({ type: 'next' }), CONFIG.successPauseMs);
    return () => clearTimeout(id);
  }, [state.celebrating, dispatch]);

  const onSuccess = useCallback(() => dispatch({ type: 'hit' }), [dispatch]);

  return (
    <main className="screen screen-juego">
      <header className="game-top">
        <div className="round-dots" aria-label={`Letra ${state.index + 1} de ${state.letters.length}`}>
          {state.letters.map((l, i) => (
            <span key={i} className={`dot dot-${state.results[i]} ${i === state.index ? 'dot-current' : ''}`}>
              {state.results[i] === 'pendiente' ? '' : l}
            </span>
          ))}
        </div>
        <TimerSemaforo timeLeft={state.timeLeft} />
      </header>

      <p className="instruction">Hacé esta letra y sostenela un momento</p>

      <SignTrainer
        recognizer={recognizer}
        target={target}
        paused={state.celebrating}
        onSuccess={onSuccess}
        onCameraStatus={onCameraStatus}
      >
        <div className="actions">
          <button className="btn btn-secondary" onClick={() => dispatch({ type: 'skip' })} disabled={state.celebrating}>
            Saltar letra
          </button>
          <button className="btn btn-ghost" onClick={() => dispatch({ type: 'home' })}>
            Salir
          </button>
        </div>
      </SignTrainer>
    </main>
  );
}
