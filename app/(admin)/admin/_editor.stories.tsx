import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Tag } from "@/components/ui/tag";
import { EditorHeader, EditorMessages, FormSection, SaveButton } from "./_editor";

function Editor({ state, successMessage }: React.ComponentProps<typeof EditorMessages>) {
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <EditorHeader
        backHref="/admin/team"
        label="Edit Anggota Tim"
        meta={
          <Tag tone="green" size="sm">
            Aktif
          </Tag>
        }
      >
        <SaveButton label="Simpan Perubahan" />
      </EditorHeader>
      <div className="max-w-4xl px-6 pt-6 pb-12 md:px-10">
        <EditorMessages state={state} successMessage={successMessage} />
        <div className="space-y-6 rounded-2xl border border-gray-100 bg-white p-6 md:p-8">
          <FormSection title="Identitas" description="Nama dan jabatan yang tampil di halaman Tim.">
            <Field label="Nama" required>
              <Input required defaultValue="Contoh Anggota" />
            </Field>
            <Field label="Jabatan" hint="Contoh: Koordinator Pembinaan.">
              <Input defaultValue="Koordinator Pembinaan" />
            </Field>
          </FormSection>
          <FormSection title="Profil">
            <Field label="Bio singkat">
              <Textarea rows={3} defaultValue="Relawan sejak 2021." />
            </Field>
          </FormSection>
        </div>
      </div>
    </form>
  );
}

const meta = {
  title: "Admin/Editor",
  component: Editor,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  globals: { backgrounds: { value: "gray" } },
  args: { state: { status: "idle" } },
} satisfies Meta<typeof Editor>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The parts every admin editor shares: the sticky `EditorHeader` (back link,
 * what is being edited, extra `meta`, actions), `SaveButton`, the
 * `EditorMessages` banners and titled `FormSection`s.
 */
export const Default: Story = {};

export const Saved: Story = {
  args: { state: { status: "success", message: "Perubahan disimpan." } },
};

export const SaveFailed: Story = {
  args: { state: { status: "error", message: "Nama wajib diisi." } },
};

export const OnPhone: Story = {
  globals: { backgrounds: { value: "gray" }, viewport: { value: "mobile", isRotated: false } },
};
