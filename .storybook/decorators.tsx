import type { Decorator } from "@storybook/nextjs-vite";

/** The admin shell around a page: gray background, the page's own padding. */
export const adminPage: Decorator = (Story) => (
  <div className="min-h-screen bg-gray-50">
    <Story />
  </div>
);

/** The centered white card the sign-in, register and password pages use. */
export const authCard: Decorator = (Story) => (
  <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
    <div className="w-full max-w-md">
      <div className="bg-white rounded-2xl shadow-lg p-8 space-y-6">
        <Story />
      </div>
    </div>
  </main>
);
