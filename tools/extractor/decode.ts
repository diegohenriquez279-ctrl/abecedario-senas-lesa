/**
 * Decodifica un mp4 completo con WebCodecs (demux con mp4box). Llama a
 * `onFrame` con cada VideoFrame en orden de presentación; el frame se cierra
 * automáticamente al volver. Es determinista y no depende de reproducir el
 * video en tiempo real (el navegador puede estar en segundo plano).
 */
import { createFile, DataStream, Endianness, MP4BoxBuffer, type Sample } from 'mp4box';

export async function decodeAll(buf: ArrayBuffer, onFrame: (f: VideoFrame) => void): Promise<void> {
  const file = createFile();
  const samples: Sample[] = [];
  let track: any = null;
  file.onError = (e: unknown) => console.error('mp4box', e);
  file.onReady = (info: any) => {
    track = info.videoTracks[0];
    file.setExtractionOptions(track.id, null, { nbSamples: Number.MAX_SAFE_INTEGER });
    file.start();
  };
  file.onSamples = (_id: number, _user: unknown, s: Sample[]) => {
    samples.push(...s);
  };
  file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buf, 0), true);
  file.flush();
  if (!track) throw new Error('No se encontró pista de video en el mp4');

  const trak: any = file.getTrackById(track.id);
  let description: Uint8Array | undefined;
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const ds = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(ds);
      description = new Uint8Array(ds.buffer as ArrayBuffer, 8);
      break;
    }
  }

  let failure: unknown = null;
  // Los frames salen en orden de presentación, pero por si acaso ordenamos
  // con una pequeña ventana (B-frames).
  const pending: VideoFrame[] = [];
  const flushPending = (all: boolean) => {
    pending.sort((a, b) => a.timestamp - b.timestamp);
    while (pending.length > (all ? 0 : 4)) {
      const f = pending.shift()!;
      try {
        onFrame(f);
      } finally {
        f.close();
      }
    }
  };
  const decoder = new VideoDecoder({
    output: (frame) => {
      pending.push(frame);
      flushPending(false);
    },
    error: (e) => {
      failure = e;
    },
  });
  decoder.configure({
    codec: track.codec,
    codedWidth: track.video.width,
    codedHeight: track.video.height,
    description,
  });

  for (const s of samples) {
    if (failure) throw failure;
    decoder.decode(
      new EncodedVideoChunk({
        type: s.is_sync ? 'key' : 'delta',
        timestamp: (1e6 * s.cts) / s.timescale,
        duration: (1e6 * s.duration) / s.timescale,
        data: s.data!,
      }),
    );
    if (decoder.decodeQueueSize > 6) {
      await new Promise((r) => decoder.addEventListener('dequeue', r, { once: true }));
    }
  }
  await decoder.flush();
  flushPending(true);
  decoder.close();
  if (failure) throw failure;
}
