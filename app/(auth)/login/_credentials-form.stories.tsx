import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { authCard } from "../../../.storybook/decorators";
import { CredentialsForm } from "./_credentials-form";
import { GoogleButton } from "./_google-button";

const meta = {
  title: "Auth/Login",
  component: CredentialsForm,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [authCard],
  args: { from: null },
} satisfies Meta<typeof CredentialsForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The email and password form. Signing in does nothing in Storybook. */
export const Credentials: Story = {};

/** The whole card as on `/login`: Google first, then email and password. */
export const WithGoogle: Story = {
  render: (args) => (
    <>
      <form onSubmit={(e) => e.preventDefault()}>
        <GoogleButton />
      </form>
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-gray-200" />
        </div>
      </div>
      <CredentialsForm {...args} />
    </>
  ),
};

export const OnPhone: Story = {
  ...WithGoogle,
  globals: { viewport: { value: "mobile", isRotated: false } },
};
