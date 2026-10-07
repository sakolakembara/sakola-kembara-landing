import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import ProblemSection from "./ProblemSection";

const meta = {
  title: "Sections/Problem",
  component: ProblemSection,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ProblemSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** *Mengapa Kami Ada?*: the problem in numbers on navy, with the *Mengapa ini terjadi?* modal. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
