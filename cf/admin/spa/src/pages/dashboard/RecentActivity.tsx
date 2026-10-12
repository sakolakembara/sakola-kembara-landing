import { Link } from "react-router";
import { activityHref, activityLabel } from "~/lib/audit";
import type { ActivityItem } from "~/lib/dashboard";
import { formatDateTime } from "~/lib/format";

/** "Aktivitas terakhir": the newest entries of the activity log, with a link to all of it. */
export function RecentActivity({ items, showAllLink }: { items: ActivityItem[]; showAllLink: boolean }) {
  return (
    <section aria-labelledby="dash-activity" className="overflow-hidden rounded-xl border border-gray-100 bg-white">
      <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
        <h2 id="dash-activity" className="text-base font-semibold text-gray-900">
          Aktivitas terakhir
        </h2>
        {showAllLink && (
          <Link to="/audit" className="text-xs font-medium text-primary-blue hover:underline">
            Semua
          </Link>
        )}
      </header>
      {items.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-gray-500">Belum ada aktivitas. Setiap aksi admin akan muncul di sini.</p>
      ) : (
        <ul role="list" className="divide-y divide-gray-100">
          {items.map((item) => {
            const href = activityHref(item.action, item.resourceType, item.resourceId);
            const body = (
              <div className="flex items-start justify-between gap-3 px-6 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900">{activityLabel(item.action)}</div>
                  <div className="mt-0.5 truncate text-xs text-gray-500">{item.actorEmail}</div>
                </div>
                <time className="shrink-0 text-xs text-gray-500" dateTime={item.createdAt}>
                  {formatDateTime(item.createdAt)}
                </time>
              </div>
            );
            return (
              <li key={item.id}>
                {href ? (
                  <Link to={href} className="block transition-colors hover:bg-gray-50">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
