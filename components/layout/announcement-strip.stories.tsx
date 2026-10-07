import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { Announcement } from "@/lib/db/schema";
import { AnnouncementStrip } from "./announcement-strip";

const base: Announcement = {
  id: "00000000-0000-0000-0000-000000000000",
  title: "Pendaftaran Gen 6 dibuka",
  body: "Daftar sebelum 30 November.",
  severity: "info",
  ctaLabel: null,
  ctaUrl: null,
  active: true,
  startsAt: null,
  endsAt: null,
  createdBy: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
};

const meta = {
  title: "Organisms/AnnouncementStrip",
  component: AnnouncementStrip,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: { announcement: base },
} satisfies Meta<typeof AnnouncementStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The strip above the navbar, written by admins in *Pengumuman*. Its colors follow the severity. */
export const Info: Story = {};

export const Warning: Story = {
  args: { announcement: { ...base, severity: "warning", title: "Batas pendaftaran tinggal 3 hari" } },
};

export const Urgent: Story = {
  args: { announcement: { ...base, severity: "urgent", title: "Jadwal tes diundur", body: "Cek email untuk jadwal baru." } },
};

/** With a call to action. The pill shape is an admin-configured exception to "no pill buttons". */
export const WithCta: Story = {
  args: { announcement: { ...base, ctaLabel: "Daftar Sekarang", ctaUrl: "/gabung-siswa" } },
};

export const WithCtaOnPhone: Story = {
  ...WithCta,
  globals: { viewport: { value: "mobile", isRotated: false } },
};
