import { AlertCircle, CalendarRange, ClipboardCheck, Inbox, UserPlus } from "lucide-react";
import type { ComponentType } from "react";
import { Link } from "react-router";
import type { Dashboard, DashboardBatch } from "~/lib/dashboard";
import { formatDate } from "~/lib/format";

type Icon = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

/** What a batch needs, in the words of the legacy batch list ("Buka", "Menunggu keputusan"). */
export function batchSummary(batch: DashboardBatch): { text: string; attention: boolean } {
  switch (batch.phase) {
    case "upcoming":
      return { text: `Dibuka ${formatDate(batch.opensAt)}`, attention: false };
    case "open":
      return { text: `Buka sampai ${formatDate(batch.closesAt)}`, attention: false };
    case "awaiting_decisions":
      return { text: `Menunggu keputusan: ${batch.undecided} belum diputuskan`, attention: true };
    case "ready_to_publish":
      return { text: "Siap dipublikasikan", attention: true };
    case "published":
      return { text: "Hasil dipublikasikan", attention: false };
  }
}

/**
 * "Perlu perhatian": what is waiting for someone, each tile a link to the list
 * already filtered to it. The server decides which tiles there are (only those
 * of areas the caller may see) and where each leads (`to`); this draws what it
 * is given, in a fixed order. Tiles with something to do take the amber look of
 * the legacy stat cards. When there is nothing to show, or every count is zero
 * and no batch needs a look, it says so.
 */
export function Attention({ attention }: { attention: Dashboard["attention"] }) {
  const { pendingApplications, underReviewApplications, unreadMessages, batch } = attention;
  const batchInfo = batch ? batchSummary(batch) : null;
  const nothing = (pendingApplications?.count ?? 0) === 0 && (underReviewApplications?.count ?? 0) === 0 && (unreadMessages?.count ?? 0) === 0 && !batch;

  return (
    <section aria-labelledby="dash-attention" className="mb-8">
      <h2 id="dash-attention" className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Perlu perhatian
      </h2>
      {nothing ? (
        <p className="rounded-xl border border-gray-100 bg-white px-6 py-8 text-center text-sm text-gray-500">
          Tidak ada yang perlu ditindaklanjuti saat ini.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {pendingApplications && (
            <Tile
              to={pendingApplications.to}
              icon={UserPlus}
              label="Pendaftar pending"
              value={String(pendingApplications.count)}
              attention={pendingApplications.count > 0}
            />
          )}
          {underReviewApplications && (
            <Tile
              to={underReviewApplications.to}
              icon={ClipboardCheck}
              label="Pendaftar dalam review"
              value={String(underReviewApplications.count)}
              attention={underReviewApplications.count > 0}
            />
          )}
          {unreadMessages && (
            <Tile
              to={unreadMessages.to}
              icon={Inbox}
              label="Pesan belum dibaca"
              value={String(unreadMessages.count)}
              attention={unreadMessages.count > 0}
            />
          )}
          {batch && batchInfo && (
            <Tile
              to={batch.to}
              icon={CalendarRange}
              label={`Batch ${batch.year}`}
              value={batchInfo.text}
              attention={batchInfo.attention}
              compact
            />
          )}
        </div>
      )}
    </section>
  );
}

function Tile({
  to,
  icon: IconComponent,
  label,
  value,
  attention,
  compact,
}: {
  to: string;
  icon: Icon;
  label: string;
  value: string;
  attention: boolean;
  /** The value is a sentence, not a number: smaller type. */
  compact?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`group block rounded-xl border p-4 transition-colors ${
        attention
          ? "border-amber-200 bg-amber-50 hover:border-amber-300"
          : "border-gray-100 bg-white hover:border-primary-blue/30"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <IconComponent size={16} aria-hidden="true" className={attention ? "text-amber-700" : "text-gray-400"} />
        {attention && <AlertCircle size={14} role="img" aria-label="Perlu tindakan" className="text-amber-600" />}
      </div>
      <div
        className={`${compact ? "text-base font-bold leading-snug" : "text-2xl font-extrabold leading-none"} ${
          attention ? "text-amber-900" : "text-primary-blue"
        }`}
      >
        {value}
      </div>
      <div className={`mt-1 text-xs ${attention ? "text-amber-800" : "text-gray-500"}`}>{label}</div>
    </Link>
  );
}
