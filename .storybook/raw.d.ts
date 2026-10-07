// Vite's `?raw` imports (file contents as a string), used by foundations.tsx.
declare module "*?raw" {
  const content: string;
  export default content;
}
