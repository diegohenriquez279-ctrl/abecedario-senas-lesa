/**
 * Las 30 letras del abecedario dactilológico, en el orden en que aparecen en
 * el video de referencia. `priorTipo` es solo un prior para validar la
 * medición del extractor: el tipo real (estática/dinámica) sale de los datos.
 */
export interface LetterInfo {
  id: string;
  priorTipo: 'estatica' | 'dinamica' | 'revisar';
}

export const LETTERS: LetterInfo[] = [
  { id: 'A', priorTipo: 'estatica' },
  { id: 'B', priorTipo: 'estatica' },
  { id: 'C', priorTipo: 'estatica' },
  { id: 'CH', priorTipo: 'revisar' },
  { id: 'D', priorTipo: 'estatica' },
  { id: 'E', priorTipo: 'estatica' },
  { id: 'F', priorTipo: 'estatica' },
  { id: 'G', priorTipo: 'revisar' },
  { id: 'H', priorTipo: 'revisar' },
  { id: 'I', priorTipo: 'estatica' },
  { id: 'J', priorTipo: 'dinamica' },
  { id: 'K', priorTipo: 'revisar' },
  { id: 'L', priorTipo: 'estatica' },
  { id: 'LL', priorTipo: 'revisar' },
  { id: 'M', priorTipo: 'estatica' },
  { id: 'N', priorTipo: 'estatica' },
  { id: 'Ñ', priorTipo: 'dinamica' },
  { id: 'O', priorTipo: 'estatica' },
  { id: 'P', priorTipo: 'estatica' },
  { id: 'Q', priorTipo: 'revisar' },
  { id: 'R', priorTipo: 'estatica' },
  { id: 'RR', priorTipo: 'dinamica' },
  { id: 'S', priorTipo: 'estatica' },
  { id: 'T', priorTipo: 'estatica' },
  { id: 'U', priorTipo: 'estatica' },
  { id: 'V', priorTipo: 'estatica' },
  { id: 'W', priorTipo: 'estatica' },
  { id: 'X', priorTipo: 'revisar' },
  { id: 'Y', priorTipo: 'estatica' },
  { id: 'Z', priorTipo: 'dinamica' },
];
