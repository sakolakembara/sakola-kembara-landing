// Class strings of the design-system atoms, copied verbatim from the root
// components/ui/* (DESIGN.md section 11). The React versions build them with
// class-variance-authority + tailwind-merge; here they are plain lookups so the
// Worker bundle carries neither. Tailwind finds the classes because they are
// spelled out in full in this file.

export type ClassValue = string | false | null | undefined;

/** Join class names, dropping falsy values. */
export const cx = (...parts: ClassValue[]): string => parts.filter(Boolean).join(' ');

// ---- Button ---------------------------------------------------------------

export type ButtonVariant =
  | 'primary'
  | 'outline'
  | 'outline-navy'
  | 'outline-on-navy'
  | 'yellow-on-navy'
  | 'white-on-navy'
  | 'danger'
  | 'subtle'
  | 'neutral';
export type ButtonSize = 'sm' | 'md' | 'lg';

const buttonBase =
  'inline-flex items-center justify-center gap-2 text-center font-semibold disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:shrink-0';

const buttonVariant: Record<ButtonVariant, string> = {
  primary: 'bg-primary-blue text-white hover:bg-primary-blue-dark',
  outline: 'border-[1.5px] border-primary-blue text-primary-blue hover:bg-primary-blue/5',
  // The outlined action of the homepage (SAKEM-111): deep navy on light sections.
  'outline-navy': 'border-[1.5px] border-primary-blue-dark text-primary-blue-dark hover:bg-primary-blue-dark/5',
  'outline-on-navy': 'border-[1.5px] border-white/60 text-white hover:bg-white/10',
  'yellow-on-navy': 'bg-secondary-yellow text-gray-900 hover:bg-secondary-yellow/90',
  'white-on-navy': 'bg-white text-primary-blue hover:bg-gray-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  subtle: 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-primary-blue',
  neutral:
    'border border-gray-200 text-gray-700 hover:border-primary-blue/40 hover:bg-primary-blue/5 hover:text-primary-blue',
};

const buttonSize: Record<ButtonSize, string> = {
  sm: 'min-h-10 rounded-[10px] px-4 py-2 text-[15px] leading-snug',
  md: 'min-h-11 rounded-[10px] px-5 py-2 text-[15px] leading-snug',
  lg: 'rounded-xl px-8 py-4 text-base',
};

export function buttonClasses(opts: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}): string {
  const { variant = 'primary', size = 'md', fullWidth, className } = opts;
  return cx(
    buttonBase,
    // A caller that sets its own transition (the hero CTA lifts on hover) replaces the default one.
    !className?.includes('transition-') && 'transition-colors',
    buttonVariant[variant],
    buttonSize[size],
    fullWidth && 'w-full',
    className,
  );
}

/** External URLs open in a new tab; files, mailto/tel and downloads are plain links. */
export function linkKind(href: string): 'external' | 'plain' | 'route' {
  if (/^https?:\/\//.test(href)) return 'external';
  const path = href.split(/[?#]/)[0];
  if (/^(mailto:|tel:)/.test(href) || /\.[a-z0-9]+$/i.test(path)) return 'plain';
  return 'route';
}

// ---- Container ------------------------------------------------------------

export type ContainerSize = 'page' | 'focused' | 'reading';
const containerSize: Record<ContainerSize, string> = {
  page: 'max-w-[1200px]',
  focused: 'max-w-[1000px]',
  reading: 'max-w-[800px]',
};
export const containerClasses = (size: ContainerSize = 'page', className?: string) =>
  cx('mx-auto w-full px-6', containerSize[size], className);

// ---- Heading --------------------------------------------------------------

export type HeadingLevel = 'display' | 'page' | 'article' | 'section' | 'subsection' | 'panel' | 'card';
// Written as font-[family-name:var(--font-display)] on purpose (DESIGN.md section 3).
const display = 'font-[family-name:var(--font-display)]';
// The homepage's type (SAKEM-111, made the site standard by Dzul on 2026-10-28, SAKEM-112): Plus Jakarta Sans 500, tight
// tracking, one fluid size per level. --font-display is Plus Jakarta Sans since then (global.css); Lora is no longer used.
const headingLevel: Record<HeadingLevel, string> = {
  display: `${display} font-medium text-[clamp(34px,4.2vw,66px)] leading-[1.12] tracking-[-0.025em]`,
  page: `${display} font-medium text-[clamp(36px,4.6vw,64px)] leading-[1.1] tracking-[-0.025em]`,
  article: `${display} font-medium text-[clamp(30px,3.6vw,52px)] leading-[1.15] tracking-[-0.025em]`,
  section: `${display} font-medium text-[clamp(32px,3.9vw,56px)] leading-[1.15] tracking-[-0.025em]`,
  subsection: `${display} font-medium text-[clamp(24px,2.4vw,36px)] leading-tight tracking-[-0.02em]`,
  panel: 'text-2xl font-medium tracking-[-0.02em]',
  card: 'text-xl font-medium tracking-[-0.02em]',
};
export const headingDefaultTag: Record<HeadingLevel, 'h1' | 'h2' | 'h3'> = {
  display: 'h1',
  page: 'h1',
  article: 'h1',
  section: 'h2',
  subsection: 'h2',
  panel: 'h3',
  card: 'h3',
};
export const headingClasses = (level: HeadingLevel = 'section', className?: string) =>
  cx(headingLevel[level], className);

// ---- Tag ------------------------------------------------------------------

export type TagSize = 'sm' | 'md' | 'lg';
const tagSize: Record<TagSize, string> = {
  sm: 'px-2.5 py-1',
  md: 'px-3 py-1.5',
  lg: 'px-3 py-1.5 text-sm',
};
export type TagTone = 'brand' | 'soft' | 'blue' | 'amber' | 'green' | 'red' | 'purple' | 'gray';
const tagTone: Record<TagTone, string> = {
  /** Category and phase tags. */
  brand: 'bg-primary-blue text-white',
  /** Quiet chips, e.g. "290+ jam belajar setahun". */
  soft: 'bg-primary-blue/10 text-primary-blue',
  // Hues for categories and statuses in lists (the report category on /laporan).
  blue: 'border border-blue-200 bg-blue-50 text-blue-700',
  amber: 'border border-amber-200 bg-amber-50 text-amber-700',
  green: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
  red: 'border border-red-200 bg-red-50 text-red-700',
  purple: 'border border-purple-200 bg-purple-50 text-purple-700',
  gray: 'border border-gray-200 bg-gray-50 text-gray-700',
};
export const tagClasses = (size: TagSize = 'md', className?: string, tone: TagTone = 'brand') =>
  cx('inline-flex items-center gap-1.5 rounded-full text-xs font-semibold', tagTone[tone], tagSize[size], className);

// ---- Eyebrow --------------------------------------------------------------

export const eyebrowClasses = (tone: 'light' | 'dark' = 'light', className?: string) =>
  cx(
    'inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wider',
    tone === 'dark' ? 'text-secondary-yellow' : 'text-primary-blue',
    className,
  );

/**
 * The polaroid frame (SAKEM-111, every photo card since SAKEM-112): a thin frame with a deeper bottom strip, tilted by `--tilt` and
 * straightened and lifted when its `group` is hovered. Shared by the homepage blog and alumni cards, /blog and /tim; the
 * caller adds the paper colour and a shadow for its background. `polaroidTilted` is the tilt and hover alone (for a card
 * with its own padding); `polaroidTilt(i)` gives the i-th card its tilt, in order.
 */
export const polaroidTilted =
  'transition-transform duration-300 ease-out [transform:rotate(var(--tilt))] group-hover:[transform:rotate(0deg)_translateY(-6px)] motion-reduce:transition-none';
export const polaroidFrame = `${polaroidTilted} rounded-[4px] p-1.5 pb-6 md:p-2 md:pb-7`;
const POLAROID_TILTS = [-1.2, 0.8, -0.6, 1];
export const polaroidTilt = (index: number) => `--tilt:${POLAROID_TILTS[index % POLAROID_TILTS.length]}deg`;
