/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" only for `pnpm dev:spa:mock`: serves fake API answers from src/mock. Never set for a build. */
  readonly VITE_ADMIN_MOCK?: string;
}
