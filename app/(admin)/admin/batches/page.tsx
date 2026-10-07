import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth-helpers";
import { getAllBatches } from "@/lib/admission-batches";
import { TableHint } from "../_table-hint";
import { Table, TableCard, THead, Th, TBody, Td } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { AdminPageHeader } from "../_page-header";
import { Tag, type TagTone } from "@/components/ui/tag";

export const metadata: Metadata = {
  title: "Batch Pendaftaran",
};

const DATE_FMT: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
};

function batchState(opensAt: Date, closesAt: Date, published: Date | null): {
  label: string;
  tone: TagTone;
} {
  const now = new Date();
  if (now < opensAt) {
    return {
      label: "Akan datang",
      tone: "gray",
    };
  }
  if (now >= opensAt && now <= closesAt) {
    return {
      label: "Buka",
      tone: "green",
    };
  }
  if (published) {
    return {
      label: "Hasil dipublikasikan",
      tone: "soft",
    };
  }
  return {
    label: "Menunggu keputusan",
    tone: "amber",
  };
}

export default async function BatchesPage() {
  await requireAdmin();
  const batches = await getAllBatches();

  return (
    <div className="p-6 md:p-10">
      <AdminPageHeader
        title="Batch Pendaftaran"
        actions={
          <Button href="/admin/batches/new">
            <Plus size={16} /> Batch Baru
          </Button>
        }
      >
        <p className="text-gray-600">
          Pendaftaran siswa dibuka satu batch per tahun. Buat batch baru untuk
          membuka periode pendaftaran, lalu publikasikan hasil setelah semua
          keputusan selesai.
        </p>
      </AdminPageHeader>

      <TableCard>
        {batches.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            Belum ada batch. Klik <span className="font-semibold">Batch Baru</span>{" "}
            untuk membuka periode pendaftaran pertama.
          </div>
        ) : (
          <Table>
            <TableHint />
            <THead>
              <tr>
                <Th>Tahun</Th>
                <Th>Nama</Th>
                <Th>Periode</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {batches.map((b) => {
                const state = batchState(b.opensAt, b.closesAt, b.resultsPublishedAt);
                return (
                  <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                    <Td className="font-mono font-medium text-gray-900">
                      {b.year}
                    </Td>
                    <Td className="text-gray-900">{b.name}</Td>
                    <Td className="text-gray-600 text-xs">
                      {b.opensAt.toLocaleString("id-ID", DATE_FMT)} —{" "}
                      {b.closesAt.toLocaleString("id-ID", DATE_FMT)}
                    </Td>
                    <Td>
                      <Tag tone={state.tone} size="sm">
                        {state.label}
                      </Tag>
                    </Td>
                    <Td>
                      <Link
                        href={`/admin/batches/${b.id}`}
                        className="text-primary-blue font-medium hover:underline"
                      >
                        Kelola
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </TBody>
          </Table>
        
        )}
      </TableCard>
    </div>
  );
}

