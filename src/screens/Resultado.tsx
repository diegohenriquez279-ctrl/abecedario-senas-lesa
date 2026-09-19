import { CONFIG } from '../config';
import { computeScore, type GameState } from '../game/state';
import type { RecordResult } from '../game/record';

interface Props {
  state: GameState;
  /** resultado del récord de esta ronda (null mientras se calcula) */
  record: RecordResult | null;
  onRetry: () => void;
  onHome: () => void;
}

export function Resultado({ state, record, onRetry, onHome }: Props) {
  const s = computeScore(state);
  return (
    <main className="screen screen-resultado">
      <div className={`result-badge ${s.passed ? 'result-ok' : 'result-retry'}`}>
        <span className="result-score">{s.score}</span>
        <span className="result-label">puntos</span>
      </div>
      {record?.isNew && (
        <p className="new-record" role="status">
          🏆 ¡Nuevo récord!
        </p>
      )}
      <p className="score-breakdown">
        Aciertos {s.hitsPoints} + Rapidez {s.speedPoints}
        {record?.best && !record.isNew && <> · Tu récord: {record.best.puntos}</>}
      </p>
      <h1>{s.passed ? '¡Aprobado!' : '¡Casi! Seguí practicando'}</h1>
      <p className="subtitle">
        {state.timedOut
          ? 'Se terminó el tiempo. ¡La próxima sale!'
          : s.passed
            ? 'Excelente deletreo.'
            : `Necesitás ${CONFIG.passScore} puntos para aprobar.`}
      </p>

      <dl className="stats">
        <div>
          <dt>Aciertos</dt>
          <dd>
            {s.hits} / {s.total}
          </dd>
        </div>
        <div>
          <dt>Por practicar</dt>
          <dd>{s.misses}</dd>
        </div>
        <div>
          <dt>Tiempo</dt>
          <dd>{s.timeUsed} s</dd>
        </div>
      </dl>

      <ul className="letter-results" aria-label="Resultado por letra">
        {state.letters.map((l, i) => (
          <li key={i} className={state.results[i] === 'ok' ? 'lr-ok' : 'lr-miss'}>
            <span className="lr-letter">{l}</span>
            <span className="lr-mark" aria-label={state.results[i] === 'ok' ? 'lograda' : 'para practicar'}>
              {state.results[i] === 'ok' ? '✓' : '↻'}
            </span>
          </li>
        ))}
      </ul>

      <button className="btn btn-primary btn-big" onClick={onRetry}>
        Reintentar
      </button>
      <button className="btn btn-secondary" onClick={onHome}>
        Volver al inicio
      </button>
    </main>
  );
}
