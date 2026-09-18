// Servidor de desarrollo sin HMR para la herramienta interna /tools/extractor/
// (puerto 5174). Una recarga automática cortaría una extracción en curso.
process.env.EXTRACTOR = '1';
const { createServer } = await import('vite');
const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
server.printUrls();
console.log('Extractor: http://localhost:5174/tools/extractor/');
