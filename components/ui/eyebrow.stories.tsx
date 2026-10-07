import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Eyebrow } from "./eyebrow";

const meta = {
  title: "Atoms/Eyebrow",
  component: Eyebrow,
  tags: ["autodocs"],
  args: { children: "Program Kami" },
  argTypes: { tone: { control: "inline-radio", options: ["light", "dark"] } },
} satisfies Meta<typeof Eyebrow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};

/** On navy the text turns yellow; the dot is always yellow. */
export const Dark: Story = {
  args: { tone: "dark", children: "Dampak Kami" },
  globals: { backgrounds: { value: "navy" } },
};
