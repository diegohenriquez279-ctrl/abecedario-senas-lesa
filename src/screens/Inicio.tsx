import { CONFIG } from '../config';
import type { BestScore } from '../game/record';

interface Props {
  best: BestScore | null;
  onStart: () => void;
  onPractice: () => void;
}

export function Inicio({ best, onStart, onPractice }: Props) {
  return (
    <main className="screen screen-inicio">
      <div className="hero" aria-hidden="true">
        <span className="hero-letter">A</span>
        <span className="hero-letter">B</span>
        <span className="hero-letter">C</span>
      </div>
      <h1>Abecedario en Señas</h1>
      <p className="subtitle">Practicá el deletreo en LESA frente a tu cámara</p>

      <ol className="rules">
        <li>Vas a ver una letra y un dibujo de cómo se hace.</li>
        <li>Hacé la seña frente a la cámara, con cualquier mano, y sostenela.</li>
        <li>
          {CONFIG.roundSize} letras en {CONFIG.roundSeconds} s: mientras más rápido y preciso, más puntos.
        </li>
        <li>Aprobás con {CONFIG.passScore} puntos. ¡Superá tu récord!</li>
      </ol>

      {best && (
        <p className="best-score">
          🏆 Tu récord: <strong>{best.puntos}</strong> puntos
        </p>
      )}

      <button className="btn btn-primary btn-big" onClick={onStart}>
        Comenzar
      </button>
      <button className="btn btn-secondary" onClick={onPractice}>
        Práctica libre
      </button>

      <p className="privacy">
        🔒 La cámara se procesa solo en tu dispositivo: no se graba ni se envía ninguna imagen.
      </p>
    </main>
  );
}
