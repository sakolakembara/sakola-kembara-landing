import type { Metadata } from "next";
import Link from "next/link";
import { Edit, Lock, Plus, ShieldCheck, User as UserIcon } from "lucide-react";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users, type AdminRole } from "@/lib/db/schema";
import { countSuperAdmins, getAllAdmins } from "@/lib/users";
import { DeleteButton } from "./_delete-button";
import { TableHint } from "../_table-hint";
import { Table, TableCard, THead, Th, TBody, Td } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { AdminPageHeader } from "../_page-header";
import { Alert } from "@/components/ui/alert";
import { Tag, type TagTone } from "@/components/ui/tag";

export const metadata: Metadata = {
  title: "Pengaturan",
};

const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  editor: "Editor",
  viewer: "Viewer",
};

const ROLE_TONE: Record<AdminRole, TagTone> = {
  super_admin: "soft",
  editor: "green",
  viewer: "gray",
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
      <AdminPageHeader
        title="Pengaturan"
        actions={
          isSuperAdmin && (
            <Button href="/admin/settings/new">
              <Plus size={16} /> Tambah Admin
            </Button>
          )
        }
      >
        <p className="text-gray-600">
          Kelola admin yang dapat mengakses dashboard.
        </p>
      </AdminPageHeader>

      {created && (
        <Alert tone="success" className="mb-4">Admin berhasil ditambahkan.</Alert>
      )}
      {deleted && <Alert tone="success" className="mb-4">Admin berhasil dihapus.</Alert>}
      {error && <Alert className="mb-4">{error}</Alert>}

      {!isSuperAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 text-sm text-amber-800 flex items-start gap-2">
          <Lock size={16} className="shrink-0 mt-0.5" />
          <span>
            Hanya <strong>Super Admin</strong> yang dapat menambah, mengubah,
            atau menghapus admin. Anda dapat melihat daftar di bawah ini.
          </span>
        </div>
      )}

      <TableCard>
        {admins.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            Belum ada admin terdaftar.
          </div>
        ) : (
          <Table>
            <TableHint />
            <THead>
              <tr>
                <Th>Email</Th>
                <Th>Nama</Th>
                <Th>Peran</Th>
                <Th>Login Terakhir</Th>
                <Th />
              </tr>
            </THead>
            <TBody>
              {admins.map((u) => {
                const isSelf = u.id === currentRow?.id;
                const isLastSuper =
                  u.role === "super_admin" && superAdminCount <= 1;
                return (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <Td className="align-middle">
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
                    </Td>
                    <Td className="align-middle text-gray-700">
                      {u.name ?? "—"}
                    </Td>
                    <Td className="align-middle">
                      <Tag tone={ROLE_TONE[u.role as AdminRole]} size="sm">
                        {ROLE_LABEL[u.role as AdminRole]}
                      </Tag>
                    </Td>
                    <Td className="align-middle text-gray-500 text-xs">
                      {u.lastLoginAt
                        ? u.lastLoginAt.toLocaleString("id-ID", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : "Belum pernah"}
                    </Td>
                    <Td className="align-middle text-right whitespace-nowrap">
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

