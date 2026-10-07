import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Container } from "./container";

const meta = {
  title: "Atoms/Container",
  component: Container,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: { children: "page · 1200px" },
  argTypes: { size: { control: "inline-radio", options: ["page", "focused", "reading"] } },
} satisfies Meta<typeof Container>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `page` (1200, default), `focused` (1000, two-column pages), `reading` (800, articles). All have 24px side padding. */
export const Sizes: Story = {
  render: () => (
    <div className="space-y-3 py-6">
      {(["page", "focused", "reading"] as const).map((size) => (
        <Container key={size} size={size}>
          <div className="rounded-lg bg-gray-100 py-3 text-center text-sm text-gray-600">{size}</div>
        </Container>
      ))}
    </div>
  ),
};
