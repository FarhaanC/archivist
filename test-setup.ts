/**
 * Test environment shims. Loaded before any test module so that Dexie sees an
 * IndexedDB implementation at import time — the store is a module-level
 * singleton, so a shim installed inside a test file is already too late.
 */
import 'fake-indexeddb/auto';

if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => void store.set(key, String(value)),
            removeItem: (key: string) => void store.delete(key),
            clear: () => void store.clear(),
            key: (index: number) => [...store.keys()][index] ?? null,
            get length() {
                return store.size;
            },
        },
    });
}
