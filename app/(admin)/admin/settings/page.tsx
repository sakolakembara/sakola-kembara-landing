import type { Metadata } from "next";
import Link from "next/link";
import { Edit, Lock, Plus, ShieldCheck, User as UserIcon } from "lucide-react";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users, type AdminRole } from "@/lib/db/schema";
import { countSuperAdmins, getAllAdmins } from "@/lib/users";
import { DeleteButton } from "./_delete-button";

export const metadata: Metadata = {
  title: "Pengaturan",
};

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  editor: "Editor",
  viewer: "Viewer",
};

const ROLE_PILL: Record<AdminRole, string> = {
  super_admin: "bg-primary-blue/10 text-primary-blue",
  editor: "bg-emerald-50 text-emerald-700",
  viewer: "bg-gray-100 text-gray-600",
};

interface PageProps {
  searchParams: Promise<{ deleted?: string; created?: string; error?: string }>;
}

export default async function SettingsPage({ searchParams }: PageProps) {
  const { deleted, created, error } = await searchParams;
  const [session, admins, superAdminCount] = await Promise.all([
    auth(),
    getAllAdmins(),
    countSuperAdmins(),
  ]);
  const currentEmail = session?.user?.email?.toLowerCase() ?? "";
  const currentRow = currentEmail
    ? await db.query.users.findFirst({
        where: eq(users.email, currentEmail),
        columns: { id: true, role: true },
      })
    : null;
  const isSuperAdmin = currentRow?.role === "super_admin";

  return (
    <div className="p-6 md:p-10">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-[var(--font-display)] text-3xl text-gray-900 mb-1">
            Pengaturan
          </h1>
          <p className="text-gray-600">
            Kelola admin yang dapat mengakses dashboard.
          </p>
        </div>
        {isSuperAdmin && (
          <Link
            href="/admin/settings/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
          >
            <Plus size={16} /> Tambah Admin
          </Link>
        )}
      </header>

      {created && (
        <Banner tone="success">Admin berhasil ditambahkan.</Banner>
      )}
      {deleted && <Banner tone="success">Admin berhasil dihapus.</Banner>}
      {error && <Banner tone="error">{error}</Banner>}

      {!isSuperAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 text-sm text-amber-800 flex items-start gap-2">
          <Lock size={16} className="shrink-0 mt-0.5" />
          <span>
            Hanya <strong>Super Admin</strong> yang dapat menambah, mengubah,
            atau menghapus admin. Anda dapat melihat daftar di bawah ini.
          </span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {admins.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            Belum ada admin terdaftar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <Th>Email</Th>
                  <Th>Nama</Th>
                  <Th>Peran</Th>
                  <Th>Login Terakhir</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {admins.map((u) => {
                  const isSelf = u.id === currentRow?.id;
                  const isLastSuper =
                    u.role === "super_admin" && superAdminCount <= 1;
                  return (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 align-middle">
                        <div className="flex items-center gap-2">
                          {u.role === "super_admin" ? (
                            <ShieldCheck
                              size={16}
                              className="text-primary-blue shrink-0"
                            />
                          ) : (
                            <UserIcon
                              size={16}
                              className="text-gray-400 shrink-0"
                            />
                          )}
                          <span className="font-medium text-gray-900">
                            {u.email}
                          </span>
                          {isSelf && (
                            <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                              Anda
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle text-gray-700">
                        {u.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <span
                          className={`inline-block text-xs font-semibold px-2 py-1 rounded-full ${ROLE_PILL[u.role as AdminRole]}`}
                        >
                          {ROLE_LABEL[u.role as AdminRole]}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-middle text-gray-500 text-xs">
                        {u.lastLoginAt
                          ? u.lastLoginAt.toLocaleString("id-ID", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : "Belum pernah"}
                      </td>
                      <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
                        {isSuperAdmin ? (
                          <>
                            <Link
                              href={`/admin/settings/${u.id}/edit`}
                              className="inline-flex items-center gap-1 text-primary-blue text-sm font-medium hover:underline mr-3"
                            >
                              <Edit size={14} /> Edit
                            </Link>
                            <DeleteButton
                              id={u.id}
                              email={u.email}
                              disabled={isSelf || isLastSuper}
                              disabledReason={
                                isSelf
                                  ? "Tidak dapat menghapus akun sendiri"
                                  : "Tidak dapat menghapus super admin terakhir"
                              }
                            />
                          </>
                        ) : (
                          <span className="text-gray-300 text-xs">
                            Read-only
                          </span>
                        )}
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

function Banner({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: React.ReactNode;
}) {
  const cls =
    tone === "success"
      ? "bg-green-50 border-green-200 text-green-700"
      : "bg-red-50 border-red-200 text-red-700";
  return (
    <div className={`border rounded-lg px-4 py-2 mb-4 text-sm ${cls}`}>
      {children}
    </div>
  );
}
