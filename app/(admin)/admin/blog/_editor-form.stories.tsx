import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { sampleArticles } from "../../../../.storybook/fixtures";
import { adminPage } from "../../../../.storybook/decorators";
import { EditorForm } from "./_editor-form";

const meta = {
  title: "Admin/Editors/Blog post",
  component: EditorForm,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [adminPage],
  args: { mode: "create", defaultAuthor: "Tim Sakola Kembara" },
} satisfies Meta<typeof EditorForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A new, empty form. Saving does nothing in Storybook (the button stays on "Menyimpan..."). */
export const Create: Story = {};

/** Editing an existing item. */
export const Edit: Story = {
  args: { mode: "edit", article: sampleArticles[0], defaultAuthor: "Tim Sakola Kembara" },
};

/** After saving, the page reloads with a success message. */
export const Saved: Story = {
  args: { mode: "edit", article: sampleArticles[0], successMessage: "Perubahan disimpan.", defaultAuthor: "Tim Sakola Kembara" },
};

export const OnPhone: Story = {
  ...Edit,
  globals: { viewport: { value: "mobile", isRotated: false } },
};
