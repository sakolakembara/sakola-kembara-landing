import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Container } from "@/components/ui/container";
import BlogPostContent from "./BlogPostContent";

const markdown = `Program pembinaan Sakola Kembara berjalan sepanjang tahun ajaran. Siswa belajar bersama setiap pekan dan didampingi mentor dari perguruan tinggi negeri.

## Apa saja kegiatannya?

Setiap pekan siswa mengikuti tiga kegiatan utama:

- KBM pekanan bersama pengajar relawan
- Mentoring dengan alumni
- Try out berkala untuk mengukur kemajuan

### Asrama intensif

Menjelang UTBK, siswa tinggal di asrama selama dua pekan untuk belajar penuh waktu.

> Kami hadir untuk memastikan setiap anak punya kesempatan yang sama.

Informasi lengkap ada di halaman [Gabung Siswa](/gabung-siswa).

| Kegiatan | Frekuensi |
| --- | --- |
| KBM pekanan | Setiap pekan |
| Try out | Setiap bulan |
`;

const meta = {
  title: "Organisms/BlogPostContent",
  component: BlogPostContent,
  tags: ["autodocs"],
  args: { markdown },
  decorators: [
    (Story) => (
      <Container size="reading">
        <Story />
      </Container>
    ),
  ],
} satisfies Meta<typeof BlogPostContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The body of a blog article, rendered from markdown with the `.blog-content` styles. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
