import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DeleteButton as DeleteAnnouncement } from "./announcements/_delete-button";
import { DeleteButton as DeleteBlogPost } from "./blog/_delete-button";
import { DeleteButton as DeleteMessage } from "./messages/_delete-button";
import { DeleteButton as DeleteReport } from "./reports/_delete-button";
import { DeleteButton as DeleteResource } from "./resources/_delete-button";
import { DeleteButton as DeleteAdmin } from "./settings/_delete-button";
import { CopyButton } from "./shortlinks/_copy-button";
import { DeleteButton as DeleteShortlink } from "./shortlinks/_delete-button";
import { DeleteButton as DeleteTeamMember } from "./team/_delete-button";

function RowActions() {
  const rows: [string, React.ReactNode][] = [
    ["Pengumuman", <DeleteAnnouncement key="a" id="1" title="Contoh Pengumuman" />],
    ["Artikel blog", <DeleteBlogPost key="b" slug="contoh" title="Contoh Artikel" />],
    ["Pesan", <DeleteMessage key="m" id="1" fullName="Contoh Pengirim" />],
    ["Laporan", <DeleteReport key="r" id="1" title="Contoh Laporan" />],
    ["Resource", <DeleteResource key="s" id="1" title="Contoh Resource" />],
    ["Anggota tim", <DeleteTeamMember key="t" id="1" name="Contoh Anggota" />],
    ["Shortlink", <DeleteShortlink key="l" id="1" slug="daftar" />],
    ["Admin", <DeleteAdmin key="u" id="1" email="admin@contoh.test" />],
    ["Admin (akun sendiri)", <DeleteAdmin key="v" id="2" email="saya@contoh.test" disabled disabledReason="Tidak bisa menghapus akun sendiri." />],
    ["Salin shortlink", <CopyButton key="c" url="https://sakolakembara.org/daftar" />],
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
      {rows.map(([label, action]) => (
        <div key={label} className="flex items-center justify-between gap-4 border-b border-gray-100 px-4 py-3 last:border-b-0">
          <span className="text-sm text-gray-600">{label}</span>
          {action}
        </div>
      ))}
    </div>
  );
}

const meta = {
  title: "Admin/Row actions",
  component: RowActions,
  globals: { backgrounds: { value: "gray" } },
} satisfies Meta<typeof RowActions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The delete and copy buttons at the end of admin table rows. Deleting asks for confirmation; in Storybook nothing is deleted. */
export const All: Story = {};
