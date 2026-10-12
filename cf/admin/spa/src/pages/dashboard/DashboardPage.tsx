import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { PageHeader } from "~/components/PageHeader";
import { useDashboard } from "~/lib/dashboard";
import { displayName } from "~/lib/me";
import { accessToPath } from "~/lib/nav";
import { useMe } from "~/lib/session";
import { Attention } from "./Attention";
import { QuickActions } from "./QuickActions";
import { RecentActivity } from "./RecentActivity";

/**
 * The dashboard (`/`): what needs attention, shortcuts, and recent activity.
 * Block order follows docs/cloudflare/admin-ia.md section 3.3. Data comes from
 * `GET /api/dashboard` (contract in lib/dashboard.ts); the shortcuts do not
 * need it, so they show while the data loads or fails.
 */
export function DashboardPage() {
  const me = useMe();
  const { state, reload } = useDashboard();
  // The summary of the activity log is shown to whoever may open Aktivitas.
  const mayReadActivity = accessToPath(me, "/audit") !== "none";

  return (
    <div className="p-6 md:p-10">
      <PageHeader title={<>Halo, {displayName(me)}</>} documentTitle="Dashboard" className="mb-8">
        <p className="text-gray-600">Ringkasan aktivitas Sakola Kembara hari ini.</p>
      </PageHeader>

      {state.status === "loading" && <LoadingBlocks withActivity={mayReadActivity} />}

      {state.status === "ready" && <Attention attention={state.data.attention} />}

      {(state.status === "unavailable" || state.status === "error") && (
        <section aria-label="Perlu perhatian" className="mb-8 space-y-3">
          <Alert tone={state.status === "unavailable" ? "info" : "danger"}>
            {state.status === "unavailable"
              ? "Data dashboard belum tersedia di admin baru."
              : "Gagal memuat data dashboard. Silakan coba lagi."}
          </Alert>
          {state.status === "error" && (
            <Button variant="neutral" size="sm" onClick={reload}>
              Coba lagi
            </Button>
          )}
        </section>
      )}

      <QuickActions me={me} />

      {state.status === "ready" && mayReadActivity && state.data.recentActivity && (
        <RecentActivity items={state.data.recentActivity} showAllLink />
      )}
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-gray-100 motion-reduce:animate-none", className)} />;
}

function LoadingBlocks({ withActivity }: { withActivity: boolean }) {
  return (
    <div role="status" aria-busy="true" className="mb-8 space-y-8">
      <span className="sr-only">Memuat dashboard…</span>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((n) => (
          <Skeleton key={n} className="h-24" />
        ))}
      </div>
      {withActivity && <Skeleton className="h-64" />}
    </div>
  );
}
