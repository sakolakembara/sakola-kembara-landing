import type { Metadata } from "next";
import Link from "next/link";
import { Edit, Plus, User } from "lucide-react";
import { getAllTeamMembers } from "@/lib/team";
import { TEAM_CATEGORY_LABEL, TEAM_CATEGORY_PILL } from "@/lib/team-types";
import { DeleteButton } from "./_delete-button";

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
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-[var(--font-display)] text-3xl text-gray-900 mb-1">
            Tim
          </h1>
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
        </div>
        <Link
          href="/admin/team/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
        >
          <Plus size={16} /> Tambah Anggota
        </Link>
      </header>

      {created && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-4 text-sm text-green-700">
          Anggota berhasil ditambahkan.
        </div>
      )}
      {deleted && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 mb-4 text-sm text-green-700">
          Anggota berhasil dihapus.
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {members.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            Belum ada anggota tim. Klik "Tambah Anggota" untuk membuat.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <Th>Foto</Th>
                  <Th>Nama</Th>
                  <Th>Peran</Th>
                  <Th>Kategori</Th>
                  <Th>Urutan</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {members.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 align-middle">
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
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <Link
                        href={`/admin/team/${m.id}/edit`}
                        className="font-medium text-gray-900 hover:text-primary-blue"
                      >
                        {m.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 align-middle text-gray-700">
                      {m.role}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span
                        className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full border ${TEAM_CATEGORY_PILL[m.category]}`}
                      >
                        {TEAM_CATEGORY_LABEL[m.category]}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-middle text-gray-500 text-xs font-mono">
                      {m.displayOrder}
                    </td>
                    <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
                      <Link
                        href={`/admin/team/${m.id}/edit`}
                        className="inline-flex items-center gap-1 text-primary-blue text-sm font-medium hover:underline mr-3"
                      >
                        <Edit size={14} /> Edit
                      </Link>
                      <DeleteButton id={m.id} name={m.name} />
                    </td>
                  </tr>
                ))}
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
