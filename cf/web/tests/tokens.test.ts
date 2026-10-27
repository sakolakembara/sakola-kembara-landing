import { describe, expect, it } from 'vitest';
import { readRoot, readWeb } from './helpers';

/** Custom properties declared inside the first block that starts with `selector {`. */
function declarations(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  let depth = 0;
  let i = css.indexOf('{', start);
  const begin = i + 1;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) break;
  }
  const body = css.slice(begin, i).replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/** Every rule whose selector mentions .blog-content, whitespace-normalised. */
function blogContentRules(source: string): string[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]*\.blog-content[^{}]*)\{([^}]*)\}/g)].map(
    (m) => `${m[1].trim().replace(/\s+/g, ' ')} { ${m[2].trim().replace(/\s+/g, ' ')} }`,
  );
}

const root = readRoot('app/globals.css');
const web = readWeb('src/styles/global.css');

describe('design tokens: cf/web copy vs the root app/globals.css (DESIGN.md section 2 and 3)', () => {
  it(':root custom properties are identical', () => {
    const rootVars = declarations(root, ':root');
    expect(Object.keys(rootVars).length).toBeGreaterThan(20);
    expect(declarations(web, ':root')).toEqual(rootVars);
  });

  it('@theme inline tokens are identical (colors, status colors, fonts), except the display font (SAKEM-112)', () => {
    const rootTheme = declarations(root, '@theme inline');
    expect(Object.keys(rootTheme)).toContain('--color-primary-blue');
    expect(Object.keys(rootTheme)).toContain('--font-display');
    expect(declarations(web, '@theme inline')).toEqual({ ...rootTheme, '--font-display': '"Plus Jakarta Sans", sans-serif' });
  });

  it('brand values from DESIGN.md', () => {
    const vars = declarations(web, ':root');
    expect(vars['--catalina-blue']).toBe('#122E76');
    expect(vars['--sunglow']).toBe('#FAD02B');
    expect(vars['--may-green']).toBe('#4BA442');
    expect(vars['--space-cadet']).toBe('#233656');
    expect(vars['--light-blue']).toBe('#B4D9DB');
  });

  it('fonts: Plus Jakarta Sans for headings and body (SAKEM-112: Lora is gone), self-hosted (no Google Fonts)', () => {
    const theme = declarations(web, '@theme inline');
    expect(theme['--font-display']).toBe('"Plus Jakarta Sans", sans-serif');
    expect(theme['--font-body']).toBe('"Plus Jakarta Sans", sans-serif');
    expect(web).not.toContain('@fontsource/lora');
    expect(web).toContain('@fontsource/plus-jakarta-sans/latin-400.css');
    expect(web).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });

  it('heading scale stays inside @layer base (DESIGN.md: unlayered rules beat every utility)', () => {
    const layer = web.slice(web.indexOf('@layer base {'));
    for (const sel of ['h1, .text-h1', 'h2, .text-h2', 'h3, .text-h3', '.text-display']) expect(layer).toContain(sel);
    const rootLayer = root.slice(root.indexOf('@layer base {'), root.indexOf('/* Custom animation'));
    const norm = (s: string) => s.replace(/\s+/g, ' ');
    expect(norm(layer.slice(0, layer.indexOf('/* Focus visible'))).trim()).toBe(norm(rootLayer).trim());
  });

  it('.blog-content rules are identical', () => {
    const rootRules = blogContentRules(root);
    expect(rootRules.length).toBeGreaterThan(15);
    expect(blogContentRules(web)).toEqual(rootRules);
  });

  it('the hero-top variables that clear the fixed navbar are identical', () => {
    for (const needle of ['--hero-top: 6.5rem;', '--hero-top: 11.5rem;', '--hero-top: 8rem;', '--hero-top: 11rem;']) {
      expect(root).toContain(needle);
      expect(web).toContain(needle);
    }
  });

  it('the focus ring is the same', () => {
    const ring = ':focus-visible {\n  outline: 3px solid var(--light-blue);\n  outline-offset: 2px;\n}';
    expect(root).toContain(ring);
    expect(web).toContain(ring);
  });

  it('does not carry the Next-only parts: Leaflet styles and the @source exclusions', () => {
    expect(web).not.toContain('leaflet');
    expect(web).not.toContain('@source not');
    expect(root).toContain('@source not "../cf"'); // commit 1: the legacy app skips cf/
  });
});
