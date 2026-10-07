import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SocialLinks } from "./social-links";

const meta = {
  title: "Molecules/SocialLinks",
  component: SocialLinks,
  tags: ["autodocs"],
  argTypes: { theme: { control: "inline-radio", options: ["dark", "light"] } },
} satisfies Meta<typeof SocialLinks>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The default, for the navy footer. */
export const Dark: Story = {
  globals: { backgrounds: { value: "navy" } },
};

export const Light: Story = {
  args: { theme: "light" },
};
