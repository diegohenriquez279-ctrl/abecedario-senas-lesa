import { useEffect, useMemo, useReducer, useState } from 'react';
import { CONFIG } from './config';
import referenceJson from './data/alphabet_reference.json';
import { initialState, pickLetters, reducer } from './game/state';
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

  // Privacidad: la cámara se apaga en cuanto termina la ronda.
  useEffect(() => {
    if (state.screen === 'resultado') stopCamera();
  }, [state.screen]);

  const start = () => dispatch({ type: 'start', letters: pickLetters(ALL_LETTERS, CONFIG.roundSize) });
  const home = () => {
    stopCamera();
    setPractice(false);
    dispatch({ type: 'home' });
  };

  if (GALERIA) return <Galeria reference={reference} />;
  if (practice) return <Practica recognizer={recognizer} letters={ALL_LETTERS} onHome={home} />;
  if (state.screen === 'juego') return <Juego state={state} dispatch={dispatch} recognizer={recognizer} />;
  if (state.screen === 'resultado') return <Resultado state={state} onRetry={start} onHome={home} />;
  return <Inicio onStart={start} onPractice={() => setPractice(true)} />;
}
