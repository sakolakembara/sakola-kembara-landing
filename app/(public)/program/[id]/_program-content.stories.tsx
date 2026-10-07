import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { programs } from "@/lib/data";
import { sampleGallery } from "../../../../.storybook/fixtures";
import ProgramContent from "./_program-content";

const meta = {
  title: "Public/ProgramContent",
  component: ProgramContent,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: { program: programs[1], gallery: sampleGallery },
} satisfies Meta<typeof ProgramContent>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The body of `/program/[id]`: hero, stage stepper, activities, gallery and the PitchDeck box. The gallery uses sample photos. */
export const Pembinaan: Story = {};

export const Prapembinaan: Story = { args: { program: programs[0] } };

export const PascaPembinaan: Story = { args: { program: programs[2] } };

export const OnPhone: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
};
