import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Alert } from "./alert";

const meta = {
  title: "Atoms/Alert",
  component: Alert,
  tags: ["autodocs"],
  args: { children: "Email atau password salah." },
  argTypes: { tone: { control: "inline-radio", options: ["danger", "success", "warning", "info"] } },
  decorators: [
    (Story) => (
      <div className="max-w-[760px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Errors are `role="alert"` (announced right away); the other tones are `role="status"`. */
export const Danger: Story = {};

export const Success: Story = {
  args: { tone: "success", children: "Tautan reset sudah dikirim ke email kamu." },
};

export const Warning: Story = {
  args: { tone: "warning", children: "Tautan reset tidak lengkap." },
};

export const Info: Story = {
  args: { tone: "info", children: "Pendaftaran Gen 6 dibuka sampai 30 November." },
};
