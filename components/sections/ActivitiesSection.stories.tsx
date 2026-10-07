import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import ActivitiesSection from "./ActivitiesSection";

const meta = {
  title: "Sections/Activities",
  component: ActivitiesSection,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ActivitiesSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** *Program Kami*: the three program phases as cards that each link to their page. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
