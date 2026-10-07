import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Download, FileText, Save } from "lucide-react";
import { Button, buttonVariants } from "./button";

const row = "flex flex-wrap items-center gap-4";

const meta = {
  title: "Atoms/Button",
  component: Button,
  tags: ["autodocs"],
  args: { children: "Daftar Sekarang" },
  argTypes: {
    variant: {
      control: "select",
      options: ["primary", "outline", "subtle", "neutral", "danger", "outline-on-navy", "yellow-on-navy", "white-on-navy"],
    },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** The variants for white and light-gray backgrounds. `danger` is only for destructive, irreversible actions. */
export const Variants: Story = {
  render: () => (
    <div className={row}>
      <Button>Daftar Sekarang</Button>
      <Button variant="outline">Lihat Detail</Button>
      <Button variant="subtle">Hubungi Kami</Button>
      <Button variant="neutral">Masuk</Button>
      <Button variant="danger">Cabut Penerimaan</Button>
    </div>
  ),
};

/** For navy sections and cards. */
export const OnNavy: Story = {
  globals: { backgrounds: { value: "navy" } },
  render: () => (
    <div className={row}>
      <Button variant="yellow-on-navy">Download PitchDeck</Button>
      <Button variant="white-on-navy">Daftar Sekarang</Button>
      <Button variant="outline-on-navy">Mengapa ini terjadi?</Button>
    </div>
  ),
};

/** `sm` (40px) is for the desktop header and admin filter rows only; touch layouts use `md` (44px) or `lg`. */
export const Sizes: Story = {
  render: () => (
    <div className={row}>
      <Button size="sm" variant="neutral">Masuk</Button>
      <Button size="md">Lihat Detail</Button>
      <Button size="lg">Kirim Pesan</Button>
    </div>
  ),
};

/** Icons sit before the label and never shrink. No arrows on buttons. */
export const WithIcon: Story = {
  render: () => (
    <div className={row}>
      <Button>
        <Save size={16} /> Simpan Perubahan
      </Button>
      <Button variant="yellow-on-navy" size="lg">
        <Download size={18} /> Download PitchDeck
      </Button>
    </div>
  ),
};

export const Disabled: Story = {
  args: { children: "Mengirim…", disabled: true },
};

/**
 * With `href` it is a link: an app route goes through `next/link`, an
 * external URL opens in a new tab, and files or downloads stay a plain `<a>`.
 */
export const Links: Story = {
  render: () => (
    <div className={row}>
      <Button href="/program/pembinaan" variant="outline">Lanjut ke Tahap 2</Button>
      <Button href="https://instagram.com/sakolakembara" variant="subtle">Instagram</Button>
      <Button href="/files/pitchdeck-sakola-kembara.pdf" download>
        <Download size={16} /> Download PitchDeck
      </Button>
    </div>
  ),
};

/**
 * On a phone a label that doesn't fit wraps and the button grows taller; the
 * icon keeps its size. These are the document buttons on `/program/[id]`.
 */
export const LongLabelOnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  render: () => (
    <div className="flex flex-col items-start gap-3">
      <Button href="/files/contoh.pdf" variant="outline">
        <FileText size={16} aria-hidden /> Contoh hasil Talents Mapping (PDF)
      </Button>
      <Button href="/files/contoh.pdf" variant="outline">
        <FileText size={16} aria-hidden /> Contoh Kurikulum Khusus (PDF)
      </Button>
    </div>
  ),
};

/**
 * Inside a card that is already one link, the CTA can't be a second link:
 * use `buttonVariants` on a `<span>`, with `group-hover:` for the hover.
 */
export const InsideLinkCard: Story = {
  render: () => (
    <a href="#" className="group block max-w-xs rounded-2xl border border-gray-100 p-6">
      <p className="mb-4 text-xl font-bold text-gray-900">Pembelajaran Intensif</p>
      <span className={buttonVariants({ fullWidth: true, className: "group-hover:bg-primary-blue-dark" })}>
        Lihat Detail
      </span>
    </a>
  ),
};
