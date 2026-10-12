import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { PageHeader } from "~/components/PageHeader";
import { expectedDashboardTiles } from "~/lib/dashboard";
import { displayName } from "~/lib/me";
import { useMe } from "~/lib/session";
import { useDashboard } from "~/lib/use-dashboard";
import { Attention } from "./Attention";
import { QuickActions } from "./QuickActions";

/**
 * The dashboard (`/`), two blocks and nothing else (decided by Dzul, SAKEM-082,
 * docs/cloudflare/admin-ia.md section 3.3): what needs attention, then the
 * shortcuts. Data comes from `GET /api/dashboard` (contract in lib/dashboard.ts),
 * which only holds what the signed-in role may see; the shortcuts do not need
 * it, so they show while the data loads or fails.
 */
export function DashboardPage() {
  const me = useMe();
  const { state, reload } = useDashboard();
  // So the loading state is not taller than what replaces it.
  const expectedTiles = expectedDashboardTiles(me);

  return (
    <div className="p-6 md:p-10">
      <PageHeader title={<>Halo, {displayName(me)}</>} documentTitle="Dashboard" className="mb-8">
        <p className="text-gray-600">Ringkasan aktivitas Sakola Kembara hari ini.</p>
      </PageHeader>

      {state.status === "loading" && <LoadingBlocks tiles={expectedTiles} />}

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
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-gray-100 motion-reduce:animate-none", className)} />;
}

function LoadingBlocks({ tiles }: { tiles: number }) {
  return (
    <div role="status" aria-busy="true" className="mb-8 space-y-8">
      <span className="sr-only">Memuat dashboard…</span>
      {tiles > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
          {Array.from({ length: tiles }, (_, n) => (
            <Skeleton key={n} className="h-24" />
          ))}
        </div>
      )}
    </div>
  );
}
