// The build-time markdown adapter: a BlogSource over the root content/blog/*.md,
// rendered by plugins/blog-content.mjs at build time. A fixture for local
// development and tests (BLOG_SOURCE=markdown); production reads the API.
//
// It answers exactly as the API contract says (same functions, blog-contract.mjs),
// so the pages and the tests can compare it with the API client one to one.
//
// Importing this file pulls every article body into the bundle (virtual:blog-bodies).
// getBlogSource() only reaches it through a dynamic import behind the build-time
// constant `__BLOG_SOURCE__`, so a production build (api) carries none of it; a test
// (tests/built.test.ts) checks the Worker bundle holds no article text.

import { bodies } from 'virtual:blog-bodies';
import { articles } from 'virtual:blog-index';
import { buildListPayload, pickRelated, toWireSummary } from '../../blog-contract.mjs';
import type { BlogSource } from './blog-source';
import { newestFirst } from './blog-source';
import type { BlogSummary } from './blog-api';

/** Every article as a wire summary, newest first. */
const summaries: BlogSummary[] = articles.map((meta) => toWireSummary(meta)).sort(newestFirst);

export const markdownBlogSource: BlogSource = {
  kind: 'markdown',
  async list(page, pageSize) {
    return { data: buildListPayload(summaries, page, pageSize), source: 'build' };
  },
  async article(slug) {
    const meta = articles.find((a) => a.id === slug);
    const summary = summaries.find((a) => a.slug === slug);
    if (!meta || !summary) return { data: null, source: 'not_found' };
    return {
      source: 'build',
      data: {
        article: { ...summary, modifiedISO: meta.modifiedISO, contentHtml: bodies[slug] ?? '' },
        related: pickRelated(summary, summaries),
      },
    };
  },
  async all() {
    return { data: summaries, source: 'build' };
  },
};
