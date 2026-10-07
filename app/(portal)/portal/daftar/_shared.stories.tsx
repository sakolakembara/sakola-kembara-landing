import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Field } from "@/components/ui/field";
import { FATHER_OCCUPATIONS, RESIDENCE_STATUSES } from "@/lib/student-form-types";
import { RadioGroup, RadioGroupWithOther, YesNoToggle } from "./_shared";

const meta = {
  title: "Portal/Choice controls",
  component: RadioGroup,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="max-w-[760px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Radio cards from the registration wizard (`/portal/daftar`), inside a `Field group`. */
export const Radio: Story = {
  args: { name: "gender", value: "", onChange: () => {}, options: [] },
  render: function Render() {
    const [value, setValue] = useState<"laki-laki" | "perempuan" | "">("");
    return (
      <Field group label="Jenis Kelamin" required>
        <RadioGroup
          name="gender"
          value={value}
          onChange={setValue}
          options={[
            { value: "laki-laki", label: "Laki-laki" },
            { value: "perempuan", label: "Perempuan" },
          ]}
        />
      </Field>
    );
  },
};

export const RadioThreeColumns: Story = {
  args: { name: "residence", value: "", onChange: () => {}, options: [] },
  render: function Render() {
    const [value, setValue] = useState("");
    return (
      <Field group label="Status Tempat Tinggal" required>
        <RadioGroup
          name="residence"
          value={value}
          onChange={setValue}
          columns={3}
          options={RESIDENCE_STATUSES.map((s) => ({ value: s, label: s }))}
        />
      </Field>
    );
  },
};

/** With a *Lainnya* option that opens a text input. */
export const RadioWithOther: Story = {
  args: { name: "fatherOccupation", value: "", onChange: () => {}, options: [] },
  render: function Render() {
    const [value, setValue] = useState("");
    return (
      <Field group label="Pekerjaan Ayah" required hint='Pilih "Lainnya" hanya jika pekerjaan tidak ada di opsi.'>
        <RadioGroupWithOther name="fatherOccupation" value={value} onChange={setValue} options={FATHER_OCCUPATIONS} />
      </Field>
    );
  },
};

/** For a yes/no question that opens more fields. */
export const YesNo: Story = {
  args: { name: "hasDebt", value: "", onChange: () => {}, options: [] },
  render: function Render() {
    const [value, setValue] = useState<boolean | null>(null);
    return (
      <Field group label="Apakah keluarga kamu memiliki hutang?">
        <YesNoToggle name="hasDebt" value={value} onChange={setValue} />
      </Field>
    );
  },
};

export const OnPhone: Story = {
  ...RadioWithOther,
  globals: { viewport: { value: "mobile", isRotated: false } },
};
