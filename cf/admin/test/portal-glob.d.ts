// `import.meta.glob` (Vite's, which Vitest runs): the portal tests read the source of whole folders as text, because
// workerd has no file system. The Worker tsconfig does not load Vite's client types, so the one signature used is declared.
// (A separate file without imports, so this is an ambient declaration.)
interface ImportMeta {
  glob<T = unknown>(pattern: string | string[], options?: { query?: string; import?: string; eager?: boolean }): Record<string, T>;
}
