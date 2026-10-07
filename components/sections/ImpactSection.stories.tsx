import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import ImpactSection from "./ImpactSection";

const meta = {
  title: "Sections/Impact",
  component: ImpactSection,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ImpactSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** *Dampak Kami*: metric cards, the branches map and the alumni testimonial carousel. The map loads tiles from the internet. */
export const Default: Story = {};

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
