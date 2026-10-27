/**
 * The homepage's GSAP motion (SAKEM-111; Dzul chose GSAP + ScrollTrigger over CSS-only on 2026-10-27). Loaded lazily by
 * a small inline script in index.astro once the page has painted, so it never delays the first view, and never with
 * reduced motion. Nothing is hidden before this runs: without JS, before it loads, or if it fails, every element simply
 * shows. Only elements still below the fold when it starts are animated, so nothing visible flickers.
 *
 * - Section titles (h2, not the screen-reader-only one): their words rise into place, line by line (SplitText).
 * - `.anim-reveal` blocks: fade and rise, in batches as they enter, staggered within a batch.
 * - The impact band's photo drifts a little against the scroll (parallax).
 * The triggers are measured again when a lazy image loads, since that moves everything under it.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

export function start() {
  gsap.registerPlugin(ScrollTrigger, SplitText);
  // The CSS scroll-driven reveal (reveal.css) stands down: GSAP runs the reveals now.
  document.documentElement.classList.add('gsap-motion');
  const below = (el: Element) => el.getBoundingClientRect().top > innerHeight * 0.9;

  for (const title of document.querySelectorAll<HTMLElement>('main h2:not(.sr-only)')) {
    if (!below(title)) continue;
    const split = SplitText.create(title, { type: 'lines,words', mask: 'lines', aria: 'auto' });
    gsap.from(split.words, {
      yPercent: 110,
      duration: 0.9,
      ease: 'power3.out',
      stagger: 0.04,
      scrollTrigger: { trigger: title, start: 'top 85%', once: true },
    });
  }

  const blocks = [...document.querySelectorAll<HTMLElement>('main .anim-reveal:not(h2)')].filter(below);
  gsap.set(blocks, { opacity: 0, y: 40 });
  ScrollTrigger.batch(blocks, {
    start: 'top 88%',
    once: true,
    onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.12, overwrite: true }),
  });

  // Lazy images that load later change the page's height: re-measure the triggers once they settle.
  let refresh = 0;
  for (const img of document.querySelectorAll<HTMLImageElement>('main img[loading="lazy"]')) {
    if (!img.complete) img.addEventListener('load', () => (clearTimeout(refresh), (refresh = window.setTimeout(() => ScrollTrigger.refresh(), 200))), { once: true });
  }

  const photo = document.querySelector<HTMLElement>('#impact > img');
  if (photo) {
    gsap.fromTo(photo, { yPercent: -6, scale: 1.12 }, { yPercent: 6, ease: 'none', scrollTrigger: { trigger: '#impact', start: 'top bottom', end: 'bottom top', scrub: true } });
  }
}
