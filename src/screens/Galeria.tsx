import type { AlphabetReference } from '../recognizer/types';
import { HandHint } from '../components/HandHint';
import { describeShape } from '../recognizer/feedback';

/** SOLO DESARROLLO (?galeria): los 30 dibujos de señas para revisarlos juntos. */
export function Galeria({ reference }: { reference: AlphabetReference }) {
  return (
    <main className="screen" style={{ maxWidth: 960 }}>
      <h1>Galería de señas</h1>
      <div className="gallery">
        {reference.letters.map((l) => (
          <figure key={l.id} className="gallery-item">
            <HandHint letter={l} flipX size={120} />
            <figcaption>
              <strong>{l.id}</strong> {l.tipo === 'dinamica' ? '· movimiento' : ''}
              <br />
              <small>{describeShape(l.proto)}</small>
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
