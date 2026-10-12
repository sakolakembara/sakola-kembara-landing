import type { Decorator } from "@storybook/nextjs-vite";

/** The admin shell around a page: gray background, the page's own padding. */
export const adminPage: Decorator = (Story) => (
  <div className="min-h-screen bg-gray-50">
    <Story />
  </div>
);
