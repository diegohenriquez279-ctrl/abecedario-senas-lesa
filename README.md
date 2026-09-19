# Abecedario en Señas (LESA) — piloto

Minijuego educativo web: la persona abre su cámara, ve una letra objetivo y un
dibujo de la seña, hace la seña dactilológica frente a la cámara y el juego
verifica en tiempo real (con el mapeo de mano de Google MediaPipe) si la hizo
bien, con feedback inmediato y amable sobre qué corregir.

> **Piloto standalone.** No está integrado a GameHut ni lleva su identidad
> visual: funciona solo, con un enlace directo. Sin branding de ninguna marca.

## Qué incluye

- **Juego (Fase 1)** — rondas de 6 letras al azar entre las 30 del abecedario
  (A B C CH D E F G H I J K L LL M N Ñ O P Q R RR S T U V W X Y Z), timer
  semáforo, puntaje y umbral de aprobación del 75 %. Se juega con **cualquiera
  de las dos manos**.
- **Práctica libre** — elegís una letra y la practicás sin reloj.
- **Reconocedor** — letras estáticas por prototipo (vecino más cercano sobre
  rasgos normalizados) y letras con movimiento por trayectoria (DTW).
- **Extractor** (`tools/extractor/`, herramienta interna que **no** se
  despliega) — genera `src/data/alphabet_reference.json` a partir del video
  de referencia.
- **Evaluación offline** (`npm run eval`) — mide aciertos y falsos positivos
  sobre el video, con mano derecha, izquierda y "otras personas" simuladas.

## Puntaje y récord

- **Puntaje 0–100** = aciertos (hasta 80) + bono de rapidez (hasta 20). El bono
  es `tiempo restante / tiempo total × 20 × aciertos / letras`: con los mismos
  aciertos, más rápido da más puntos, y saltar letras rápido no suma. Con las 6
  señas bien se llega a 80 y se aprueba (`passScore` 75) aunque se vaya lento.
  Pesos ajustables en `src/config.ts` (`scoreWeightHits`, `scoreWeightTime`).
- **Récord = mejor puntaje** (no tiempo). Al terminar cada ronda se guarda en
  `localStorage` solo si supera al anterior (un empate no lo reemplaza):

  ```
  clave: gamehut_score_lesa-abecedario
  valor: { "puntos": 92, "fecha": "2026-09-19T01:20:00.000Z" }
  ```

  `puntos` es un entero 0–100 y `fecha` el momento (ISO) en que se logró. Es el
  contrato que leerá el hub de GameHut: no renombrar la clave ni usar `score` o
  `record` dentro del objeto. Lectura y escritura están protegidas con
  `try/catch` (en incógnito el récord dura mientras la ventana privada esté
  abierta). Código: `src/game/record.ts`. La práctica libre no guarda récord.

## Privacidad

Todo corre en el navegador. **La cámara se procesa 100 % en el dispositivo:
no se graba, no se guarda y no se envía ninguna imagen a ningún servidor.**
No hay backend. El modelo de MediaPipe y su WASM vienen empaquetados en
`public/models/` (no se usa la CDN de Google en runtime).

## Requisitos

- Node 20+ (probado con Node 24).
- Navegador moderno con cámara (Chrome/Edge/Safari/Firefox recientes, en
  celular o computadora).
- **Contexto seguro**: la cámara solo funciona en `https://` o en
  `http://localhost`.

## Instalar y correr

```bash
npm install
npm run setup:models   # copia el WASM y descarga una vez hand_landmarker.task
npm run dev            # http://localhost:5173
```

Para probar desde el celular en la misma red se necesita HTTPS:

```bash
npm run dev:https      # https://<ip-de-tu-pc>:5173 (certificado autofirmado: aceptá la advertencia)
```

Build estático (carpeta `dist/`, rutas relativas, listo para cualquier hosting estático):

```bash
npm run build
npm run preview
```

## Cómo funciona el reconocimiento

1. **Landmarks**: MediaPipe HandLandmarker da 21 puntos por mano (imagen + 3D).
2. **Normalización** (`src/vision/features.ts`): si la mano es la opuesta a la
   del firmante de referencia se espeja; se traslada a la muñeca, se escala por
   el tamaño de la palma y se rota para que muñeca→base del dedo medio apunte
   arriba. La orientación original (hacia dónde apuntan los dedos y hacia dónde
   mira la palma) se guarda aparte, porque hay letras que solo difieren en eso.
3. **Rasgos**: forma 2D, forma 3D en el marco de la palma, flexión de cada dedo,
   posición del pulgar, separación entre dedos, orientación.
4. **Estáticas**: se sostiene la seña ~0,6 s; la mediana de esa ventana tiene
   que quedar dentro del umbral de la letra, ser la más cercana (con tolerancia)
   y estar quieta.
5. **Dinámicas**: DTW entre el movimiento reciente (forma + trayectoria del
   punto que traza) y la plantilla de la letra.
6. **Feedback**: se compara dedo por dedo con la letra objetivo ("Estirá el
   meñique", "Juntá el índice y el medio", "Mostrá la palma hacia la cámara").

Todas las constantes (tiempo de ronda, tamaño de ronda, umbral de aprobación,
tolerancias del reconocedor, ajustes por letra) están en `src/config.ts`.

### Letras con movimiento (medidas, no asumidas)

El extractor clasifica una letra como dinámica cuando, dentro de una misma
subida de mano, hay **pausa → movimiento → pausa** con la mano en la forma de
la letra (subir o bajar la mano no cuenta). Resultado sobre el video:
**J, LL, Ñ, RR y Z** son dinámicas; las otras 25 son estáticas (incluidas CH, G,
H, K, Q y X, que estaban en la lista para revisar).

| Letra | Movimiento detectado |
|---|---|
| J  | el meñique traza una curva hacia abajo y al costado (la forma cambia) |
| LL | la L se desplaza hacia el costado |
| Ñ  | la N oscila de lado a lado |
| RR | la R se desplaza hacia el costado |
| Z  | el índice traza la Z |

### Resultados de la evaluación offline (`npm run eval`)

| Prueba | Validadas | Falsos positivos |
|---|---|---|
| Video, mano derecha + mano izquierda (espejado) | 60/60 | 13 de 1740 |
| Con perturbación "otra persona" (`--hard`: giro ±30°, inclinación 3D ±25°, dedos ±15 %, temblor 3 %) | 60/60 | 13 de 1740 |
| Perturbación doble (`PERTURB_SCALE=2 … --hard`) | 56/60 | 18 de 1740 |
| Cuadro completo 16:9 sin recorte (`--file=raw_frames_full.json --hard`) | 30/30 | 6 de 870 |

Casi todos los falsos positivos son esperables: al hacer J, LL, Ñ o RR se pasa
por la forma de I, L, N o R (es la misma forma de mano). Lo inverso no pasa:
sostener la I quieta nunca valida la J.

> Estas pruebas usan un solo firmante (el del video). La prueba definitiva es
> con personas reales frente a la cámara; para calibrar ahí, abrí el juego con
> `?debug` (muestra las letras más cercanas con distancia/umbral) y ajustá
> `thresholdScale`, `dynThresholdScale` o `LETTER_OVERRIDES` en `src/config.ts`.

### Detalle del video de referencia

En el video, la tilde de la **Ñ** aparece más arriba que el resto de las letras
escritas; la transición N→Ñ es muy sutil. El segmentador rellena ese hueco
eligiendo el cambio más cercano al punto medio esperado (Ñ empieza en 151,0 s),
y el extractor ahora analiza una zona más alta para captarla.

## Regenerar `alphabet_reference.json`

El video de referencia (`El_abecedario_lessa.mp4`) **no** forma parte del repo
ni del deploy (está en `.gitignore`); solo se usa localmente para derivar números.

1. Poné el video en la raíz del proyecto (o elegilo con el selector de archivo).
2. `npm run extractor` y abrí `http://localhost:5174/tools/extractor/`
   (servidor sin recarga automática, para no cortar la extracción).
3. "1. Extraer landmarks": decodifica el video completo con WebCodecs y corre
   MediaPipe frame a frame (pasada normal y espejada). Guarda
   `tools/extractor/out/raw_frames*.json`.
4. `npm run build:reference`: segmenta por letra (detecta el cambio de la letra
   escrita abajo a la izquierda), calcula prototipos, mide el movimiento para
   clasificar estática/dinámica, arma las plantillas DTW y sugiere umbrales.
5. "2. Revisar segmentación" en el extractor: una tarjeta por letra con el frame
   usado y la letra escrita, para confirmar que todo coincide.
6. `npm run eval` (y `npm run eval -- --perturb`) para medir el resultado.

Si hace falta corregir algo a mano, `tools/extractor/overrides.json` acepta:
`segments` (límites de una letra), `tipo` (forzar estática/dinámica) y
`movement` (tramo del movimiento para la plantilla).

## Prueba sin cámara (solo desarrollo)

- `http://localhost:5173/?sim` reemplaza la cámara por los landmarks grabados de la
  letra objetivo (mano izquierda por defecto; `?sim=normal` mano derecha;
  `?sim=wrong` reproduce otra letra para comprobar que no valida). Requiere haber
  corrido el extractor.
- `http://localhost:5173/?galeria` muestra los 30 dibujos de señas juntos.

Ninguna de las dos existe en el build de producción.

Diagnóstico de una letra dinámica: `npx tsx tools/eval/debugDtw.ts RR R` (mejor
coincidencia de la plantilla de RR dentro del tramo de R).

## Estructura

```
index.html · vite.config.ts · tsconfig.json · package.json
public/models/            WASM + hand_landmarker.task (empaquetados)
src/config.ts             constantes ajustables
src/data/                 letras + alphabet_reference.json (generado)
src/vision/               HandLandmarker, normalización y rasgos
src/recognizer/           distancia, estático, DTW, feedback
src/game/                 estado de la ronda, puntaje, semáforo
src/components/ src/screens/   UI (Inicio, Juego, Práctica, Resultado)
tools/extractor/          extractor + buildReference (no se despliega)
tools/eval/               evaluación offline
```

## Fase 2 (prevista, no implementada)

"Formá la palabra": el `Recognizer` no tiene estado de juego
(`push(frames)` + `evaluate(letra)`), así que deletrear una palabra es avanzar
el objetivo letra por letra con el mismo reconocedor.

## Deploy

El deploy a GitHub Pages se hace **solo cuando el piloto esté aprobado** y se
pida explícitamente. El build usa rutas relativas, así que funciona en la
subruta del repo sin cambios.
