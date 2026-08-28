import { notFound, redirect } from "next/navigation";
import { recordShortlinkClick, resolveShortlink, validateSlug } from "@/lib/shortlinks";

/**
 * Vanity shortlink resolver: `https://sakolakembara.org/<slug>` → target URL.
 *
 * This sits inside the `(public)` group so an unresolved slug 404s with the
 * normal site chrome rather than a bare Next error page. It only ever runs
 * for a single-segment path that no static route and no `public/` file
 * already claims — Next resolves those first — so `/donasi`, `/tim` and
 * friends are never reached by this code.
 *
 * Redirects are 307, not 308: the admin can repoint a slug at any time, and
 * a permanent redirect would be cached by browsers well past that edit.
 */
export default async function ShortlinkRedirectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Reject anything that cannot be a slug before touching the database —
  // every 404 on the site funnels through here, including bot noise.
  const check = validateSlug(decodeURIComponent(slug));
  if (!check.ok) notFound();

  const link = await resolveShortlink(check.slug);
  if (!link) notFound();

  // Must happen before redirect() — it throws to unwind the render.
  await recordShortlinkClick(link.id);

  redirect(link.targetUrl);
}
