import { useLocation } from "react-router";
import { Tag } from "@/components/ui/tag";
import { PageHeader } from "~/components/PageHeader";
import { accessTo } from "~/lib/access";
import { type NavItem } from "~/lib/nav";
import { useMe } from "~/lib/session";

/**
 * The page of a menu entry that has not been built yet. It says so plainly,
 * shows no data, and shows what the signed-in user will be able to do there
 * (read, or read and change), which is the quickest way to see the role rules
 * working before any real page exists. Replace it by registering the real page
 * in App.tsx (see "SPA shell" in docs/cloudflare/admin-skeleton.md).
 */
export function PlaceholderPage({ item }: { item: NavItem }) {
  const me = useMe();
  const { pathname } = useLocation();
  const title = item.title ?? item.label;
  const access = accessTo(me, item.section);
  // "/blog/new" or "/blog/abc/edit": a page below the list, so offer the way back.
  const onSubPage = pathname.replace(/\/+$/, "") !== item.path;

  return (
    <div className="p-6 md:p-10">
      <PageHeader title={title} back={onSubPage ? { href: item.path, label: "Kembali ke daftar" } : undefined} />
      <section className="max-w-2xl rounded-2xl border border-gray-100 bg-white p-6 md:p-8">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Belum tersedia di admin baru</h2>
          {access === "write" && (
            <Tag tone="green" size="sm">
              Bisa mengubah
            </Tag>
          )}
          {access === "read" && (
            <Tag tone="gray" size="sm">
              Hanya baca
            </Tag>
          )}
        </div>
        <p className="text-sm leading-relaxed text-gray-600">
          Halaman {title} masih dalam proses dipindahkan ke admin baru. Belum ada data yang bisa ditampilkan di sini.
        </p>
      </section>
    </div>
  );
}
