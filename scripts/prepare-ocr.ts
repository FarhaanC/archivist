/**
 * Copy the scan reader (Tesseract) and its language data out of node_modules
 * and into public/ocr, where the app serves them itself.
 *
 * Self-hosted on purpose. The default is to fetch these from a public CDN on
 * first use, which would mean a document import silently depends on a third
 * party being up — and would stop working the moment the app is packaged as a
 * desktop program used offline. Nothing here is committed: the folder is
 * rebuilt before every dev run and build.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'public', 'ocr');

const files: [string, string][] = [
    ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
    // Three builds of the engine; the worker picks the fastest one the
    // browser supports. Only one is ever downloaded.
    ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
    ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
    ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
    // "best_int": the accurate model, shrunk to whole numbers — 3 MB rather
    // than the 11 MB standard file, and it reads at least as well.
    ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
    // Arabic, for the same reason English is here: a UAE identity card,
    // driving licence or visa puts both languages on the same page, and
    // without this the Arabic half comes back as nonsense characters that
    // then pollute search. 1.6 MB.
    ['node_modules/@tesseract.js-data/ara/4.0.0_best_int/ara.traineddata.gz', 'ara.traineddata.gz'],
];

await mkdir(out, { recursive: true });
let bytes = 0;
for (const [from, to] of files) {
    await copyFile(join(root, from), join(out, to));
    bytes += (await stat(join(out, to))).size;
}
console.log(`ocr: ${files.length} files ready in public/ocr (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
