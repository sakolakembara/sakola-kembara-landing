import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth-helpers";
import { getAllBatches } from "@/lib/admission-batches";
import { TableHint } from "../_table-hint";

export const metadata: Metadata = {
  title: "Batch Pendaftaran",
};

const DATE_FMT: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
};

function batchState(opensAt: Date, closesAt: Date, published: Date | null): {
  label: string;
  pill: string;
} {
  const now = new Date();
  if (now < opensAt) {
    return {
      label: "Akan datang",
      pill: "bg-gray-50 text-gray-600 border-gray-200",
    };
  }
  if (now >= opensAt && now <= closesAt) {
    return {
      label: "Buka",
      pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }
  if (published) {
    return {
      label: "Hasil dipublikasikan",
      pill: "bg-primary-blue/10 text-primary-blue border-primary-blue/30",
    };
  }
  return {
    label: "Menunggu keputusan",
    pill: "bg-amber-50 text-amber-700 border-amber-200",
  };
}

export default async function BatchesPage() {
  await requireAdmin();
  const batches = await getAllBatches();

  return (
    <div className="p-6 md:p-10">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-[var(--font-display)] text-3xl text-gray-900 mb-1">
            Batch Pendaftaran
          </h1>
          <p className="text-gray-600">
            Pendaftaran siswa dibuka satu batch per tahun. Buat batch baru untuk
            membuka periode pendaftaran, lalu publikasikan hasil setelah semua
            keputusan selesai.
          </p>
        </div>
        <Link
          href="/admin/batches/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
        >
          <Plus size={16} /> Batch Baru
        </Link>
      </header>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {batches.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            Belum ada batch. Klik <span className="font-semibold">Batch Baru</span>{" "}
            untuk membuka periode pendaftaran pertama.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHint />
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <Th>Tahun</Th>
                  <Th>Nama</Th>
                  <Th>Periode</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {batches.map((b) => {
                  const state = batchState(b.opensAt, b.closesAt, b.resultsPublishedAt);
                  return (
                    <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-medium text-gray-900">
                        {b.year}
                      </td>
                      <td className="px-4 py-3 text-gray-900">{b.name}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {b.opensAt.toLocaleString("id-ID", DATE_FMT)} —{" "}
                        {b.closesAt.toLocaleString("id-ID", DATE_FMT)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full border ${state.pill}`}
                        >
                          {state.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/batches/${b.id}`}
                          className="inline-flex items-center gap-1 text-primary-blue font-medium hover:underline"
                        >
                          Kelola <ArrowRight size={14} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="text-left text-xs font-semibold uppercase tracking-wide px-4 py-3">
      {children}
    </th>
  );
}
