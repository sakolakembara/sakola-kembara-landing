import { Edit, Plus, ShieldCheck, User } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Tag } from "~/components/ui/tag";
import { ConfirmDialog } from "~/components/crud/ConfirmDialog";
import { type Column, DataTable } from "~/components/crud/DataTable";
import { FilterBar } from "~/components/crud/FilterBar";
import { Flash } from "~/components/crud/Flash";
import { Pagination } from "~/components/crud/Pagination";
import { StatusTag } from "~/components/crud/StatusTag";
import { PageHeader } from "~/components/PageHeader";
import { accessTo } from "~/lib/access";
import { api } from "~/lib/api";
import { describeFailure, MESSAGES } from "~/lib/crud/errors";
import { useFlash } from "~/lib/crud/flash";
import { isFiltered } from "~/lib/crud/query";
import { useList } from "~/lib/crud/useList";
import { formatDateTime } from "~/lib/format";
import { useMe } from "~/lib/session";
import { type AdminItem, API_PATH, AREA_LABEL, LIST_SPEC, ROLE_LABEL, ROLE_TONE, ROLES, ROUTE, STATUS } from "./model";
import { useAdminAction } from "./useAdminAction";

// Pengaturan (Sistem, super_admin only): the admins, their roles and areas, and who may sign in. A port of
// app/(admin)/admin/settings/page.tsx (docs/cloudflare/admin-sistem.md): the same list and the same words, with what
// the rules changed: an admin is invited, and deactivated instead of deleted, an editor has areas, and a super_admin
// who is the last one cannot be demoted or deactivated (the Worker says so, in these words, and this screen shows it).

export function SettingsPage() {
  const me = useMe();
  const canWrite = accessTo(me, "sistem") === "write";
  const list = useList<AdminItem>(API_PATH, LIST_SPEC);
  const notice = useFlash();

  const deactivate = useAdminAction({
    verb: "deactivate",
    title: "Nonaktifkan admin?",
    describe: (row) => (
      <>
        Admin &ldquo;{row.email}&rdquo; tidak bisa masuk lagi dan semua sesinya langsung berakhir. Akunnya tidak dihapus: riwayat aktivitasnya tetap ada, dan kamu bisa mengaktifkannya lagi.
      </>
    ),
    confirmLabel: "Nonaktifkan",
    pendingLabel: "Menonaktifkan...",
    // Red, like the kit's other confirm buttons that take something away (docs/cloudflare/admin-sistem.md#46-the-screens).
    destructive: true,
    onDone: (row) => {
      notice.show({ tone: "success", text: `Admin ${row.email} dinonaktifkan.` });
      list.refetch();
    },
    onReload: list.refetch,
  });

  const reactivate = useAdminAction({
    verb: "reactivate",
    title: "Aktifkan kembali admin?",
    describe: (row) => (
      <>
        Admin &ldquo;{row.email}&rdquo; bisa masuk lagi dengan peran {ROLE_LABEL[row.role]}. Sesi yang lama tidak dipulihkan, jadi mereka perlu masuk ulang.
      </>
    ),
    confirmLabel: "Aktifkan kembali",
    pendingLabel: "Mengaktifkan...",
    onDone: (row) => {
      notice.show({ tone: "success", text: `Admin ${row.email} diaktifkan kembali.` });
      list.refetch();
    },
    onReload: list.refetch,
  });

  // Resending an invitation is one press, with no question: it only sends an email again. A second press while one is
  // in flight is ignored (by ref, not by state: two clicks can arrive before React has re-rendered).
  const [resending, setResending] = useState<string | null>(null);
  const resendLock = useRef(false);
  async function resend(row: AdminItem) {
    if (resendLock.current) return;
    resendLock.current = true;
    setResending(row.id);
    notice.dismiss();
    try {
      const result = await api(`${API_PATH}/${encodeURIComponent(row.id)}/resend-invite`, { method: "POST", json: {} });
      notice.show(result.ok ? { tone: "success", text: `Undangan dikirim ulang ke ${row.email}.` } : { tone: "danger", text: describeFailure(result).message });
      if (!result.ok && result.status === 409) list.refetch(); // it was accepted meanwhile: the row says so now
    } finally {
      resendLock.current = false;
      setResending(null);
    }
  }

  const columns: readonly Column<AdminItem>[] = [
    {
      key: "email", sort: "email",
      header: "Email",
      className: "align-middle",
      cell: (row) => (
        <div className="flex items-center gap-2">
          {row.role === "super_admin" ? <ShieldCheck size={16} aria-hidden="true" className="shrink-0 text-primary-blue" /> : <User size={16} aria-hidden="true" className="shrink-0 text-gray-400" />}
          <span className="break-all font-medium text-gray-900">{row.email}</span>
          {row.id === me.id && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Anda</span>}
        </div>
      ),
    },
    { key: "name", sort: "name", header: "Nama", className: "align-middle text-gray-700", cell: (row) => row.name || "—" },
    {
      key: "role", sort: "role",
      header: "Peran",
      className: "align-middle",
      cell: (row) => (
        <>
          <Tag tone={ROLE_TONE[row.role]} size="sm">
            {ROLE_LABEL[row.role]}
          </Tag>
          {row.role === "editor" && (
            <p className="mt-1 text-xs text-gray-500">{row.areas.length > 0 ? `Area: ${row.areas.map((area) => AREA_LABEL[area]).join(", ")}` : "Belum punya area"}</p>
          )}
        </>
      ),
    },
    { key: "status", header: "Status", className: "align-middle", cell: (row) => <StatusTag map={STATUS} value={row.status} /> },
    {
      key: "session",
      header: "Sesi Aktif",
      className: "align-middle text-xs text-gray-500",
      cell: (row) => (row.lastSessionAt ? `Sejak ${formatDateTime(row.lastSessionAt)}` : "Tidak ada"),
    },
  ];

  const actions = (row: AdminItem) =>
    canWrite ? (
      <>
        <Link to={`${ROUTE}/${encodeURIComponent(row.id)}/edit`} aria-label={`Edit ${row.email}`} className="mr-3 inline-flex items-center gap-1 text-sm font-medium text-primary-blue hover:underline">
          <Edit size={14} aria-hidden="true" /> Edit
        </Link>
        {row.status === "invited" && (
          <button
            type="button"
            onClick={() => void resend(row)}
            disabled={resending === row.id}
            aria-label={`Kirim ulang undangan ${row.email}`}
            className="mr-3 inline-flex items-center gap-1 text-sm font-medium text-primary-blue hover:underline disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resending === row.id ? "Mengirim..." : "Kirim ulang undangan"}
          </button>
        )}
        {row.status === "deactivated" ? (
          <button type="button" onClick={() => reactivate.ask(row)} aria-label={`Aktifkan kembali ${row.email}`} aria-haspopup="dialog" className="inline-flex items-center gap-1 text-sm font-medium text-primary-blue hover:underline">
            Aktifkan lagi
          </button>
        ) : row.id === me.id ? (
          // Nobody deactivates themselves: the same answer the Worker gives, said before the question.
          <span title="Tidak dapat menonaktifkan akun sendiri" className="inline-flex cursor-not-allowed items-center gap-1 text-sm font-medium text-gray-300">
            Nonaktifkan
          </span>
        ) : (
          <button type="button" onClick={() => deactivate.ask(row)} aria-label={`Nonaktifkan ${row.email}`} aria-haspopup="dialog" className="inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:underline">
            Nonaktifkan
          </button>
        )}
      </>
    ) : (
      <Link to={`${ROUTE}/${encodeURIComponent(row.id)}/edit`} aria-label={`Lihat ${row.email}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary-blue hover:underline">
        Lihat
      </Link>
    );

  return (
    <div className="p-6 md:p-10">
      <PageHeader
        title="Pengaturan"
        actions={
          canWrite ? (
            <Button href={`${ROUTE}/new`}>
              <Plus size={16} aria-hidden="true" /> Tambah Admin
            </Button>
          ) : undefined
        }
      >
        <p className="text-gray-600">Kelola admin yang dapat mengakses dashboard.</p>
      </PageHeader>

      <Flash flash={notice.flash} dismiss={notice.dismiss} />

      <FilterBar
        list={list}
        search={{ label: "Cari", placeholder: "Awal email, mis. rommy" }}
        filters={[
          { name: "role", label: "Peran", allLabel: "Semua peran", options: ROLES.map((value) => ({ value, label: ROLE_LABEL[value] })) },
          {
            name: "status",
            label: "Status",
            allLabel: "Semua status",
            options: [
              { value: "active", label: STATUS.active.label },
              { value: "invited", label: STATUS.invited.label },
              { value: "deactivated", label: STATUS.deactivated.label },
            ],
          },
        ]}
      />

      <DataTable<AdminItem>
        caption="Daftar admin"
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        state={list.status}
        errorMessage={list.failure ? describeFailure(list.failure).message : MESSAGES.loadFailed}
        onRetry={list.refetch}
        emptyText={isFiltered(list.query) ? "Tidak ada admin yang cocok dengan filter." : "Belum ada admin terdaftar."}
        emptyFiltered={isFiltered(list.query)}
        actions={actions}
        refreshing={list.refreshing}
        sort={{ value: list.query.sort, onChange: list.setSort }}
      />

      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} searchFor={list.searchFor} />

      <ConfirmDialog {...deactivate.dialogProps} />
      <ConfirmDialog {...reactivate.dialogProps} />
    </div>
  );
}
