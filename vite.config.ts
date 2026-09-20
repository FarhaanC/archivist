import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { createRequire } from 'node:module';

const { version } = createRequire(import.meta.url)('./package.json') as { version: string };

/**
 * The version a set of timings was measured on: the package version plus the
 * short commit, when there is a git checkout to ask. A build from a tarball
 * has no commit and just gets the version, which is why this never throws.
 */
const appVersion = ((): string => {
    try {
        const commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim();
        return commit ? `${version}+${commit}` : version;
    } catch {
        return version;
    }
})();

export default defineConfig({
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
    resolve: {
        alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    worker: { format: 'es' },
    server: {
        // Required for the WebLLM WASM/WebGPU pipeline to use SharedArrayBuffer.
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
    build: { target: 'es2022', sourcemap: false },
});
