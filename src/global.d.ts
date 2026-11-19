/**
 * Ambient module declarations.
 *
 * Purpose: lets TypeScript import plain-JS modules without type errors.
 * Important: every `*.js` import is typed as `any` — intentional while the
 * JS files are untyped; remove this once they are converted or typed.
 */
declare module '*.js';
