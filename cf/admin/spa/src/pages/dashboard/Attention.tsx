import { ArrowRight, CalendarRange, ClipboardCheck, Inbox, UserPlus } from "lucide-react";
import type { ComponentType } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/cn";
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
    case "closed_empty":
      // Closed and nobody applied: nothing to decide or publish, so a quiet tile.
      return { text: "Ditutup, tanpa pendaftar", attention: false };
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
 * and no batch needs a look, it says so; for an editor who has not been given
 * any area yet (`noArea`) it says to ask a super admin instead of suggesting
 * that everything is done.
 */
export function Attention({ attention, noArea = false }: { attention: Dashboard["attention"]; noArea?: boolean }) {
  const { pendingApplications, underReviewApplications, unreadMessages, batch } = attention;
  const batchInfo = batch ? batchSummary(batch) : null;
  const nothing = (pendingApplications?.count ?? 0) === 0 && (underReviewApplications?.count ?? 0) === 0 && (unreadMessages?.count ?? 0) === 0 && !batch;

  return (
    <section aria-labelledby="dash-attention" className="mb-8">
      <h2 id="dash-attention" className="mb-3.5 text-base font-semibold tracking-tight text-gray-900">
        Perlu perhatian
      </h2>
      {nothing ? (
        <p className="rounded-xl border border-gray-200 bg-white px-6 py-8 text-center text-sm text-gray-600">
          {noArea
            ? "Akunmu belum punya akses ke area mana pun. Hubungi super admin untuk meminta akses."
            : "Tidak ada yang perlu ditindaklanjuti saat ini."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
          {pendingApplications && (
            <Tile
              to={pendingApplications.to}
              icon={UserPlus}
              label="Pendaftar pending"
              value={String(pendingApplications.count)}
              attention={pendingApplications.count > 0}
              tone="amber"
            />
          )}
          {underReviewApplications && (
            <Tile
              to={underReviewApplications.to}
              icon={ClipboardCheck}
              label="Pendaftar dalam review"
              value={String(underReviewApplications.count)}
              attention={underReviewApplications.count > 0}
              tone="blue"
            />
          )}
          {unreadMessages && (
            <Tile
              to={unreadMessages.to}
              icon={Inbox}
              label="Pesan belum dibaca"
              value={String(unreadMessages.count)}
              attention={unreadMessages.count > 0}
              tone="blue"
            />
          )}
          {batch && batchInfo && (
            <Tile
              to={batch.to}
              icon={CalendarRange}
              label={`Batch ${batch.year}`}
              value={batchInfo.text}
              attention={batchInfo.attention}
              tone="amber"
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
  tone,
  compact,
}: {
  to: string;
  icon: Icon;
  label: string;
  value: string;
  attention: boolean;
  /** What kind of attention: amber waits for a decision, blue is on its way. Only seen when `attention`. */
  tone: "amber" | "blue";
  /** The value is a sentence, not a number: smaller type. */
  compact?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group block rounded-xl border bg-white p-5 transition-colors",
        !attention && "border-gray-200 hover:border-gray-300",
        attention && tone === "amber" && "border-amber-300 hover:border-amber-400",
        attention && tone === "blue" && "border-blue-200 hover:border-blue-300",
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <IconComponent size={18} aria-hidden="true" className="text-gray-400" />
        <span className="flex items-center gap-2">
          {attention && <span role="img" aria-label="Perlu tindakan" className={cn("size-2 rounded-full", tone === "amber" ? "bg-amber-500" : "bg-blue-600")} />}
          <ArrowRight size={16} aria-hidden="true" className="text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </span>
      </div>
      <div className={compact ? "text-lg font-semibold leading-snug tracking-tight text-primary-blue-dark" : "text-[34px] font-semibold leading-none tracking-tight text-primary-blue-dark"}>
        {value}
      </div>
      <div className="mt-2 text-[13px] text-gray-600">{label}</div>
    </Link>
  );
}
