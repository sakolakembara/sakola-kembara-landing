// Loader for /tim: team members from the content API. The timeout, the Workers Cache API
// (`caches.default`) and stale-if-error live in lib/content-api.ts (shared with /laporan and
// /gabung-siswa/docs); this file is the team's part: the path, the parser and the 5-minute
// fresh window (the other lists use 60 s).
//
// Cache and fetch are injected so the logic is unit tested in Node with fakes
// (tests/team.test.ts). On a real zone the Cache API only works on custom
// domains/routes, not on *.workers.dev.

import { loadContent, type ContentCallOptions, type ContentSource } from './content-api';
import { parseTeamPayload, type TeamMember } from './team-types';

export type TeamSource = ContentSource;
export interface TeamResult {
  members: TeamMember[];
  source: TeamSource;
}

export type TeamLoaderOptions = ContentCallOptions<TeamMember[]>;

export const TEAM_PATH = '/api/public/team';

/** Seconds a fetched team list stays fresh when the caller does not say otherwise. */
export const TEAM_FRESH_SECONDS = 300;

export async function loadTeam(opts: TeamLoaderOptions): Promise<TeamResult> {
  const { data, source } = await loadContent<TeamMember[]>({
    ...opts,
    freshTtlSeconds: opts.freshTtlSeconds ?? TEAM_FRESH_SECONDS,
    path: TEAM_PATH,
    parse: parseTeamPayload,
  });
  return { members: data ?? [], source };
}
