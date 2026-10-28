import { describe, expect, it } from 'vitest';
import { buttonClasses, containerClasses, cx, eyebrowClasses, headingClasses, linkKind, tagClasses } from '~/lib/ui';
import { readRoot } from './helpers';

describe('design-system class strings are the root ones', () => {
  const button = readRoot('components/ui/button.tsx');
  const heading = readRoot('components/ui/heading.tsx');
  const container = readRoot('components/ui/container.tsx');
  const tag = readRoot('components/ui/tag.tsx');
  const eyebrow = readRoot('components/ui/eyebrow.tsx');

  it('button variants and sizes appear verbatim in components/ui/button.tsx', () => {
    for (const needle of [
      'bg-primary-blue text-white hover:bg-primary-blue-dark',
      'border-[1.5px] border-primary-blue text-primary-blue hover:bg-primary-blue/5',
      'border-[1.5px] border-white/60 text-white hover:bg-white/10',
      'bg-secondary-yellow text-gray-900 hover:bg-secondary-yellow/90',
      'bg-white text-primary-blue hover:bg-gray-50',
      'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-primary-blue',
      'min-h-10 rounded-lg px-4 py-2 text-[15px] leading-snug',
      'min-h-11 rounded-lg px-5 py-2 text-[15px] leading-snug',
      'rounded-xl px-8 py-4 text-base',
    ]) {
      expect(button, needle).toContain(needle);
    }
    expect(buttonClasses({ variant: 'primary', size: 'sm' })).toContain('bg-primary-blue text-white hover:bg-primary-blue-dark');
    expect(buttonClasses({ size: 'lg', fullWidth: true })).toContain('rounded-xl px-8 py-4 text-base w-full');
  });

  it('a caller-supplied transition replaces the default transition-colors (what tailwind-merge did)', () => {
    expect(buttonClasses({ className: 'transition-all hover:-translate-y-0.5' })).not.toContain('transition-colors');
    expect(buttonClasses({ className: 'mt-auto' })).toContain('transition-colors');
  });

  it('heading levels follow the homepage standard (SAKEM-112), not the root heading.tsx any more, and use the family-name: hint', () => {
    for (const level of ['display', 'page', 'article', 'section', 'subsection', 'panel', 'card'] as const) {
      expect(headingClasses(level), level).toMatch(/\bfont-medium\b/);
      expect(headingClasses(level), level).toMatch(/tracking-\[-0\.0[0-9]+em\]/);
    }
    expect(headingClasses('section')).toContain('text-[clamp(32px,3.9vw,56px)] leading-[1.15]'); // the homepage's h2
    expect(headingClasses('display')).toContain('font-[family-name:var(--font-display)]');
    expect(headingClasses('display')).not.toContain('font-[var(--font-display)]');
  });

  it('container sizes', () => {
    for (const w of ['max-w-[1200px]', 'max-w-[1000px]', 'max-w-[800px]']) expect(container).toContain(w);
    expect(container).toContain('mx-auto w-full px-6');
    expect(containerClasses('reading', 'py-2')).toBe('mx-auto w-full px-6 max-w-[800px] py-2');
  });

  it('tag and eyebrow', () => {
    expect(tag).toContain('inline-flex items-center gap-1.5 rounded-full text-xs font-semibold');
    expect(tag).toContain('bg-primary-blue text-white');
    expect(tag).toContain('px-2.5 py-1');
    expect(tagClasses('sm')).toContain('px-2.5 py-1');
    // `soft` is the quiet chip of the legacy Tag ("290+ jam belajar setahun"); brand stays the default.
    expect(tagClasses('md', undefined, 'soft')).toContain('bg-primary-blue/10 text-primary-blue');
    expect(tagClasses('md', undefined, 'soft')).not.toContain('bg-primary-blue text-white');
    expect(tagClasses()).toBe(tagClasses('md', undefined, 'brand'));
    expect(tag).toContain('soft: "bg-primary-blue/10 text-primary-blue"');
    // the hues of the legacy Tag (report categories on /laporan), verbatim
    for (const [tone, classes] of Object.entries({
      blue: 'border border-blue-200 bg-blue-50 text-blue-700',
      amber: 'border border-amber-200 bg-amber-50 text-amber-700',
      green: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
      red: 'border border-red-200 bg-red-50 text-red-700',
      purple: 'border border-purple-200 bg-purple-50 text-purple-700',
      gray: 'border border-gray-200 bg-gray-50 text-gray-700',
    })) {
      expect(tag, tone).toContain(`${tone}: "${classes}"`);
      expect(tagClasses('sm', undefined, tone as 'blue')).toContain(classes);
    }
    expect(eyebrow).toContain('inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider');
    expect(eyebrowClasses('dark')).toContain('text-secondary-yellow');
    expect(eyebrowClasses()).toContain('text-primary-blue');
  });
});

describe('linkKind', () => {
  it.each([
    ['https://linktr.ee/x', 'external'],
    ['http://a.b', 'external'],
    ['mailto:a@b.c', 'plain'],
    ['tel:+62', 'plain'],
    ['/files/a.pdf', 'plain'],
    ['/reports/2025/a.pdf?x=1', 'plain'],
    ['/donasi', 'route'],
    ['/blog/a-b?page=2', 'route'],
    ['#activities', 'route'],
  ])('%s -> %s', (href, kind) => {
    expect(linkKind(href)).toBe(kind);
  });

  it('matches the root linkKind on the same inputs', async () => {
    // the root file is TSX importing next/link: compare on the source text instead
    const src = readRoot('components/ui/button.tsx');
    expect(src).toContain('if (/^https?:\\/\\//.test(href)) return "external";');
    expect(src).toContain('/^(mailto:|tel:)/.test(href) || /\\.[a-z0-9]+$/i.test(path)');
  });
});

describe('cx', () => {
  it('drops falsy values', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
  });
});
