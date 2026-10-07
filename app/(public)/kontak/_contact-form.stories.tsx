import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ContactForm } from "./_contact-form";

const meta = {
  title: "Public/ContactForm",
  component: ContactForm,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="max-w-[600px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ContactForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The form on `/kontak`. Sending does nothing in Storybook. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
