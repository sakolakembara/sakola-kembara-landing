import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ReviewForm } from "./_review-form";

const meta = {
  title: "Admin/Editors/Application review",
  component: ReviewForm,
  tags: ["autodocs"],
  globals: { backgrounds: { value: "gray" } },
  args: {
    applicationId: "00000000-0000-0000-0000-000000000701",
    currentStatus: "under_review",
    currentReviewNotes: null,
    formError: null,
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReviewForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The status and notes form on an application's detail page. */
export const UnderReview: Story = {};

/** For an accepted application, choosing *Ditolak* turns the form into a revocation with a required reason. */
export const Accepted: Story = {
  args: { currentStatus: "accepted", currentReviewNotes: "Berkas lengkap, wawancara baik." },
};

export const WithError: Story = {
  args: { formError: "Alasan pencabutan minimal 20 karakter." },
};
