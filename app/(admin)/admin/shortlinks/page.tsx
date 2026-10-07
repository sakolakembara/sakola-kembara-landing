import type { Metadata } from "next";
import Link from "next/link";
import { Edit, ExternalLink, Plus } from "lucide-react";
import { getAllShortlinks } from "@/lib/shortlinks";
import { SITE_URL } from "@/lib/seo";
import { TableHint } from "../_table-hint";
import { DeleteButton } from "./_delete-button";
import { CopyButton } from "./_copy-button";
import { Table, TableCard, THead, Th, TBody, Td } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { AdminPageHeader } from "../_page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Shortlink",
};

interface PageProps {
  searchParams: Promise<{ deleted?: string; error?: string }>;
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export default async function ShortlinksAdminPage({ searchParams }: PageProps) {
  const { deleted, error } = await searchParams;
  const all = await getAllShortlinks();
  const activeCount = all.filter((s) => s.active).length;

  return (
    <div className="p-6 md:p-10">
      <AdminPageHeader
        title="Shortlink"
        actions={
          <Button href="/admin/shortlinks/new" className="whitespace-nowrap">
            <Plus size={16} /> Shortlink Baru
          </Button>
        }
      >
        <p className="text-gray-600">
          {all.length} shortlink, {activeCount} aktif. Alamat pendek di{" "}
          <span className="font-mono text-sm">{SITE_URL}/slug</span> yang
          mengarahkan pengunjung ke tujuan mana pun.
        </p>
      </AdminPageHeader>

      {deleted && (
        <Alert tone="success" className="mb-4">
          Shortlink berhasil dihapus.
        </Alert>
      )}
      {error && (
        <Alert className="mb-4">
          {error}
        </Alert>
      )}

      <TableCard>
        {all.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            Belum ada shortlink. Klik &ldquo;Shortlink Baru&rdquo; untuk membuat.
          </div>
        ) : (
          <Table>
            <TableHint />
            <THead>
              <tr>
                <Th>Alamat pendek</Th>
                <Th>Tujuan</Th>
                <Th>Klik</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {all.map((row) => {
                const fullUrl = `${SITE_URL}/${row.slug}`;
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <Td className="align-top">
                      <Link
                        href={`/admin/shortlinks/${row.id}/edit`}
                        className="font-medium text-gray-900 hover:text-primary-blue font-mono"
                      >
                        /{row.slug}
                      </Link>
                      <div className="mt-1">
                        <CopyButton url={fullUrl} />
                      </div>
                      {row.note && (
                        <p className="text-xs text-gray-500 mt-1 max-w-[240px] line-clamp-2">
                          {row.note}
                        </p>
                      )}
                    </Td>
                    <Td className="align-top max-w-[320px]">
                      <a
                        href={row.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-start gap-1 text-gray-600 hover:text-primary-blue break-all"
                      >
                        <span className="line-clamp-2">{row.targetUrl}</span>
                        <ExternalLink
                          size={12}
                          className="shrink-0 mt-1"
                          aria-hidden
                        />
                      </a>
                    </Td>
                    <Td className="align-top whitespace-nowrap">
                      <div className="font-medium text-gray-900">
                        {row.clickCount}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {row.clickCount > 0
                          ? formatDate(row.lastClickedAt)
                          : "Belum diklik"}
                      </div>
                    </Td>
                    <Td className="align-top">
                      {row.active ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 whitespace-nowrap">
                          <span className="w-2 h-2 bg-green-500 rounded-full" />
                          Aktif
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">Nonaktif</span>
                      )}
                    </Td>
                    <Td className="align-top text-right whitespace-nowrap">
                      <Link
                        href={`/admin/shortlinks/${row.id}/edit`}
                        className="inline-flex items-center gap-1 text-primary-blue text-sm font-medium hover:underline mr-3"
                      >
                        <Edit size={14} /> Edit
                      </Link>
                      <DeleteButton id={row.id} slug={row.slug} />
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

