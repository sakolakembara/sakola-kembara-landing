// The Vite features the Foundations pages use: `?raw` imports (a file's
// contents as a string) and `import.meta.glob`.
declare module "*?raw" {
  const content: string;
  export default content;
}

interface ImportMeta {
  glob<T = unknown>(
    patterns: string | string[],
    options: { query?: string; import?: string; eager: true },
  ): Record<string, T>;
}
