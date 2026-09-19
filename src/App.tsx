import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CONFIG } from './config';
import referenceJson from './data/alphabet_reference.json';
import { computeScore, initialState, pickLetters, reducer } from './game/state';
import { readBest, saveIfBest, type BestScore, type RecordResult } from './game/record';
import { Recognizer } from './recognizer/recognizer';
import type { AlphabetReference } from './recognizer/types';
import { Inicio } from './screens/Inicio';
import { Juego } from './screens/Juego';
import { Practica } from './screens/Practica';
import { Resultado } from './screens/Resultado';
import { stopCamera } from './components/CameraView';
import { Galeria } from './screens/Galeria';

const GALERIA = import.meta.env.DEV && new URLSearchParams(location.search).has('galeria');

const reference = referenceJson as unknown as AlphabetReference;
const ALL_LETTERS = reference.letters.map((l) => l.id);

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [practice, setPractice] = useState(false);
  const recognizer = useMemo(() => new Recognizer(reference), []);
  const [best, setBest] = useState<BestScore | null>(() => readBest());
  const [record, setRecord] = useState<RecordResult | null>(null);
  // Cada ronda guarda su récord una sola vez (en dev, StrictMode repite los efectos).
  const round = useRef(0);
  const savedRound = useRef(-1);

  // Privacidad: la cámara se apaga en cuanto termina la ronda.
  useEffect(() => {
    if (state.screen === 'resultado') stopCamera();
  }, [state.screen]);

  // Récord por puntaje: al terminar la ronda se guarda si mejora el anterior.
  useEffect(() => {
    if (state.screen !== 'resultado' || savedRound.current === round.current) return;
    savedRound.current = round.current;
    const r = saveIfBest(computeScore(state).score);
    setRecord(r);
    setBest(r.best);
  }, [state]);

  const start = () => {
    round.current++;
    setRecord(null);
    dispatch({ type: 'start', letters: pickLetters(ALL_LETTERS, CONFIG.roundSize) });
  };
  const home = () => {
    stopCamera();
    setPractice(false);
    dispatch({ type: 'home' });
  };

  if (GALERIA) return <Galeria reference={reference} />;
  if (practice) return <Practica recognizer={recognizer} letters={ALL_LETTERS} onHome={home} />;
  if (state.screen === 'juego') return <Juego state={state} dispatch={dispatch} recognizer={recognizer} />;
  if (state.screen === 'resultado')
    return <Resultado state={state} record={record} onRetry={start} onHome={home} />;
  return <Inicio best={best} onStart={start} onPractice={() => setPractice(true)} />;
}
