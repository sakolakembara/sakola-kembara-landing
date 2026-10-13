// Vite's `?raw` import: the text of a file. The contract tests read docs/cloudflare/content-api.md as
// text, and the rate limit test reads wrangler.jsonc, because workerd has no file system.
// (A separate file without imports, so these are ambient declarations.)
declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare module "*.mjs?raw" {
  const content: string;
  export default content;
}

declare module "*.sql?raw" {
  const content: string;
  export default content;
}

declare module "*.jsonc?raw" {
  const content: string;
  export default content;
}
