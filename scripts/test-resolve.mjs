/**
 * Lets `node --test` resolve the extensionless relative imports the app source
 * uses ("./schedule"), which Vite handles at build time and Node ESM does not.
 *
 * The alternative was writing ".ts" on every import across the codebase purely
 * to satisfy the test runner — source contorted to fit its harness. Fifteen
 * lines of resolve hook is the cheaper trade, and it keeps the modules under
 * test byte-identical to the ones that ship.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register(pathToFileURL(new URL('./test-resolve-hooks.mjs', import.meta.url).pathname))
