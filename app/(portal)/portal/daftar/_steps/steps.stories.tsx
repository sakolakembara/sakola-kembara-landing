import { useCallback, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Container } from "@/components/ui/container";
import {
  emptyFormValues,
  householdSchema,
  housingSchema,
  identitySchema,
  interviewSchema,
  type FormValues,
  type StepId,
} from "@/lib/student-form-types";
import { errorsFor, filledFormValues, noErrors } from "../../../../../.storybook/fixtures";
import type { FieldErrors } from "../_shared";
import { DocumentsStep } from "./documents";
import { HouseholdStep } from "./household";
import { HousingStep } from "./housing";
import { IdentityStep } from "./identity";
import { InterviewStep } from "./interview";
import { IntroStep } from "./intro";
import { MarketingStep } from "./marketing";
import { OrganizationsStep } from "./organizations";
import { ReviewStep } from "./review";

type StepName = "intro" | "identity" | "household" | "housing" | "organizations" | "interview" | "documents" | "review";

/** One wizard step with working state, the way `_wizard.tsx` wires it. */
function Step({
  step,
  initialValues = emptyFormValues,
  initialErrors = {},
}: {
  step: StepName;
  initialValues?: FormValues;
  initialErrors?: Partial<Record<StepId, FieldErrors>>;
}) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({ ...noErrors, ...initialErrors });
  const updateStep = useCallback(<K extends keyof FormValues>(key: K, patch: Partial<FormValues[K]>) => {
    setValues((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);
  const clearFieldError = useCallback((id: StepId, path: string) => {
    setErrors((prev) => {
      const next = { ...prev[id] };
      delete next[path];
      return { ...prev, [id]: next };
    });
  }, []);
  const props = { values, updateStep, errors, clearFieldError };

  return (
    <Container size="focused" className="py-8">
      <div className="rounded-2xl border border-gray-100 bg-white p-6 md:p-8">
        {step === "intro" && <IntroStep />}
        {step === "identity" && <IdentityStep {...props} />}
        {step === "household" && <HouseholdStep {...props} />}
        {step === "housing" && <HousingStep {...props} />}
        {step === "organizations" && <OrganizationsStep {...props} />}
        {step === "interview" && <InterviewStep {...props} />}
        {step === "documents" && (
          <div className="space-y-10">
            <DocumentsStep {...props} />
            <div className="border-t border-gray-100 pt-8">
              <MarketingStep {...props} />
            </div>
          </div>
        )}
        {step === "review" && <ReviewStep values={values} onEditStep={() => {}} />}
      </div>
    </Container>
  );
}

const meta = {
  title: "Portal/Registration steps",
  component: Step,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  globals: { backgrounds: { value: "gray" } },
  args: { step: "intro" },
} satisfies Meta<typeof Step>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each step of `/portal/daftar` on its own, empty and editable. The *WithErrors* stories show the messages the wizard gives for an empty step. */
export const Intro: Story = {};

export const Identity: Story = { args: { step: "identity" } };

export const IdentityWithErrors: Story = {
  args: { step: "identity", initialErrors: { identity: errorsFor(identitySchema, emptyFormValues.identity) } },
};

export const Household: Story = { args: { step: "household" } };

export const HouseholdWithErrors: Story = {
  args: { step: "household", initialErrors: { household: errorsFor(householdSchema, emptyFormValues.household) } },
};

export const Housing: Story = { args: { step: "housing" } };

export const HousingWithErrors: Story = {
  args: { step: "housing", initialErrors: { housing: errorsFor(housingSchema, emptyFormValues.housing) } },
};

export const Organizations: Story = { args: { step: "organizations" } };

export const Interview: Story = { args: { step: "interview" } };

export const InterviewWithErrors: Story = {
  args: { step: "interview", initialErrors: { interview: errorsFor(interviewSchema, emptyFormValues.interview) } },
};

/** The documents step, with the social-media tasks below it, as in the wizard. */
export const Documents: Story = { args: { step: "documents" } };

/** The last step, filled with sample answers. */
export const Review: Story = { args: { step: "review", initialValues: filledFormValues } };

export const IdentityOnPhone: Story = {
  args: { step: "identity" },
  globals: { backgrounds: { value: "gray" }, viewport: { value: "mobile", isRotated: false } },
};
