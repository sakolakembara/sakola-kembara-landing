import type { Metadata } from "next";
import Link from "next/link";
import { Edit, Plus, User } from "lucide-react";
import { getAllTeamMembers } from "@/lib/team";
import { TEAM_CATEGORY_LABEL, TEAM_CATEGORY_TONE } from "@/lib/team-types";
import { DeleteButton } from "./_delete-button";
import { Table, TableCard, THead, Th, TBody, Td } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AdminPageHeader } from "../_page-header";
import { Tag } from "@/components/ui/tag";

export const metadata: Metadata = {
  title: "Tim",
};

interface PageProps {
  searchParams: Promise<{ deleted?: string; created?: string; error?: string }>;
}

export default async function TeamAdminPage({ searchParams }: PageProps) {
  const { deleted, created, error } = await searchParams;
  const members = await getAllTeamMembers();

  return (
    <div className="p-6 md:p-10">
      <AdminPageHeader
        title="Tim"
        actions={
          <Button href="/admin/team/new">
            <Plus size={16} /> Tambah Anggota
          </Button>
        }
      >
        <p className="text-gray-600">
          {members.length} anggota tampil di{" "}
          <Link
            href="/tim"
            target="_blank"
            className="text-primary-blue hover:underline"
          >
            /tim
          </Link>{" "}
          (dikelompokkan per kategori, lalu diurutkan berdasarkan urutan tampil).
        </p>
      </AdminPageHeader>

      {created && (
        <Alert tone="success" className="mb-4">
          Anggota berhasil ditambahkan.
        </Alert>
      )}
      {deleted && (
        <Alert tone="success" className="mb-4">
          Anggota berhasil dihapus.
        </Alert>
      )}
      {error && (
        <Alert className="mb-4">
          {error}
        </Alert>
      )}

      <TableCard>
        {members.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            Belum ada anggota tim. Klik &ldquo;Tambah Anggota&rdquo; untuk membuat.
          </div>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Foto</Th>
                <Th>Nama</Th>
                <Th>Peran</Th>
                <Th>Kategori</Th>
                <Th>Urutan</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <Td className="align-middle">
                    <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center">
                      {m.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.image}
                          alt={m.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User size={16} className="text-gray-300" />
                      )}
                    </div>
                  </Td>
                  <Td className="align-middle">
                    <Link
                      href={`/admin/team/${m.id}/edit`}
                      className="font-medium text-gray-900 hover:text-primary-blue"
                    >
                      {m.name}
                    </Link>
                  </Td>
                  <Td className="align-middle text-gray-700">
                    {m.role}
                  </Td>
                  <Td className="align-middle">
                    <Tag tone={TEAM_CATEGORY_TONE[m.category]} size="sm">
                      {TEAM_CATEGORY_LABEL[m.category]}
                    </Tag>
                  </Td>
                  <Td className="align-middle text-gray-500 text-xs font-mono">
                    {m.displayOrder}
                  </Td>
                  <Td className="align-middle text-right whitespace-nowrap">
                    <Link
                      href={`/admin/team/${m.id}/edit`}
                      className="inline-flex items-center gap-1 text-primary-blue text-sm font-medium hover:underline mr-3"
                    >
                      <Edit size={14} /> Edit
                    </Link>
                    <DeleteButton id={m.id} name={m.name} />
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
        
        )}
      </TableCard>
    </div>
  );
}

