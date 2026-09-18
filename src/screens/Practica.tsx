import { useEffect, useRef, useState } from 'react';
import type { Recognizer } from '../recognizer/recognizer';
import { SignTrainer } from '../components/SignTrainer';

interface Props {
  recognizer: Recognizer;
  letters: string[];
  onHome: () => void;
}

/** Práctica libre: elegís una letra y la practicás sin reloj. */
export function Practica({ recognizer, letters, onHome }: Props) {
  const [target, setTarget] = useState(letters[0]);
  const [done, setDone] = useState(false);
  const [count, setCount] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);

  // mantener visible la letra elegida en el selector horizontal
  useEffect(() => {
    pickerRef.current
      ?.querySelector<HTMLElement>('.pick-on')
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [target]);

  return (
    <main className="screen screen-juego">
      <header className="game-top">
        <h2 className="practice-title">Práctica libre</h2>
        <button className="btn btn-ghost" onClick={onHome}>
          Salir
        </button>
      </header>
      <div className="letter-picker" aria-label="Elegí una letra" ref={pickerRef}>
        {letters.map((l) => (
          <button
            key={l}
            aria-pressed={l === target}
            className={`pick ${l === target ? 'pick-on' : ''}`}
            onClick={() => {
              setTarget(l);
              setDone(false);
            }}
          >
            {l}
          </button>
        ))}
      </div>
      <SignTrainer
        recognizer={recognizer}
        target={target}
        paused={done}
        onSuccess={() => {
          setDone(true);
          setCount((c) => c + 1);
        }}
      >
        <div className="actions">
          {done && (
            <button className="btn btn-primary" onClick={() => setDone(false)}>
              Otra vez
            </button>
          )}
          {done && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                setTarget(letters[(letters.indexOf(target) + 1) % letters.length]);
                setDone(false);
              }}
            >
              Siguiente letra
            </button>
          )}
          <span className="practice-count">Logradas: {count}</span>
        </div>
      </SignTrainer>
    </main>
  );
}
