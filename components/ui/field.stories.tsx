import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Field, Input, Select, Textarea } from "./field";

const meta = {
  title: "Molecules/Field",
  component: Field,
  tags: ["autodocs"],
  args: { label: "Nama Lengkap", children: null },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Label, control, then a hint or an error. The control picks up its id and aria attributes from the `Field`. */
export const TextInput: Story = {
  render: () => (
    <Field label="Nama Lengkap" required>
      <Input required placeholder="Masukkan nama Anda" />
    </Field>
  ),
};

export const WithHint: Story = {
  render: () => (
    <Field label="Nomor WhatsApp" hint="Kami hanya menghubungi lewat nomor ini.">
      <Input type="tel" placeholder="08xxxxxxxxxx" />
    </Field>
  ),
};

/** The error replaces the hint and marks the control `aria-invalid`. */
export const WithError: Story = {
  render: () => (
    <Field label="Email" required error="Format email belum benar.">
      <Input type="email" required defaultValue="nama@contoh" />
    </Field>
  ),
};

export const WithSelect: Story = {
  render: () => (
    <Field label="Subjek" hint="Pilih yang paling dekat.">
      <Select defaultValue="">
        <option value="" disabled>
          Pilih subjek
        </option>
        <option>Seputar Donasi</option>
        <option>Kerjasama</option>
      </Select>
    </Field>
  ),
};

export const WithTextarea: Story = {
  render: () => (
    <Field label="Pesan">
      <Textarea rows={4} placeholder="Tulis pesan Anda di sini..." />
    </Field>
  ),
};

/** Something on the label's row, right-aligned. */
export const WithLabelAside: Story = {
  render: () => (
    <Field
      label="Password"
      labelAside={
        <a href="#" className="text-sm text-primary-blue hover:underline">
          Lupa password?
        </a>
      }
    >
      <Input type="password" placeholder="Masukkan password" />
    </Field>
  ),
};

/** `group` makes it a `<fieldset>` whose `<legend>` names a set of controls, e.g. radio cards. */
export const Group: Story = {
  render: () => (
    <Field group label="Apakah kamu pernah mengikuti program Sakola Kembara?" required>
      <div className="space-y-2">
        {["Ya", "Belum"].map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-gray-200 p-3 transition-colors hover:border-primary-blue has-[:checked]:border-primary-blue has-[:checked]:bg-primary-blue/5"
          >
            <input type="radio" name="pernah-ikut" value={option} className="accent-primary-blue" />
            <span className="text-sm font-semibold text-gray-900">{option}</span>
          </label>
        ))}
      </div>
    </Field>
  ),
};

/** Controls are 48px with 16px text. `size="sm"` (40px, 14px) is only for the filter rows above admin tables. */
export const ControlSizes: Story = {
  render: () => (
    <div className="space-y-5">
      <Field label="Standar (md)">
        <Input placeholder="Masukkan nama Anda" />
      </Field>
      <Field label="Filter admin (sm)">
        <Input size="sm" type="search" placeholder="Cari judul…" />
      </Field>
      <Field label="Select filter admin (sm)">
        <Select size="sm" defaultValue="all">
          <option value="all">Semua status</option>
        </Select>
      </Field>
    </div>
  ),
};
