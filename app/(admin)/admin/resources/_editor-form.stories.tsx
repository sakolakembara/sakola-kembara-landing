import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { sampleResource } from "../../../../.storybook/fixtures";
import { adminPage } from "../../../../.storybook/decorators";
import { EditorForm } from "./_editor-form";

const meta = {
  title: "Admin/Editors/Resource",
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
  args: { mode: "edit", resource: sampleResource },
};

export const OnPhone: Story = {
  ...Edit,
  globals: { viewport: { value: "mobile", isRotated: false } },
};
