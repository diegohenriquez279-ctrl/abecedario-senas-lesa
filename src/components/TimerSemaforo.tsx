import { CONFIG } from '../config';
import { timerColor } from '../game/state';

/** Barra de tiempo tipo semáforo: verde (>50%), amarillo (25–50%), rojo (<25%). */
export function TimerSemaforo({ timeLeft }: { timeLeft: number }) {
  const frac = Math.max(0, Math.min(1, timeLeft / CONFIG.roundSeconds));
  const color = timerColor(timeLeft);
  const secs = Math.ceil(timeLeft);
  return (
    <div className={`timer timer-${color}`} role="timer" aria-label={`Quedan ${secs} segundos`}>
      <div className="timer-track">
        <div className="timer-fill" style={{ width: `${frac * 100}%` }} />
      </div>
      <span className="timer-text">
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
      </span>
    </div>
  );
}
