// Vite's `?raw` import: the contract tests read docs/cloudflare/content-api.md as text, because workerd has no file system.
declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare module "*.mjs?raw" {
  const content: string;
  export default content;
}
