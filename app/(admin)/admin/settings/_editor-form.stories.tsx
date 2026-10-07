import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { sampleAdmin } from "../../../../.storybook/fixtures";
import { adminPage } from "../../../../.storybook/decorators";
import { EditorForm } from "./_editor-form";

const meta = {
  title: "Admin/Editors/Admin user",
  component: EditorForm,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [adminPage],
  args: { mode: "create" },
} satisfies Meta<typeof EditorForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A new, empty form. Saving does nothing in Storybook (the button stays on "Menyimpan..."). */
export const Create: Story = {};

/** Editing an existing item. */
export const Edit: Story = {
  args: { mode: "edit", user: sampleAdmin },
};

/** After saving, the page reloads with a success message. */
export const Saved: Story = {
  args: { mode: "edit", user: sampleAdmin, successMessage: "Perubahan disimpan." },
};

export const OnPhone: Story = {
  ...Edit,
  globals: { viewport: { value: "mobile", isRotated: false } },
};
