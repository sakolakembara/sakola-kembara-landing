"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { resetPasswordAction, type ResetFormState } from "./actions";

const initialState: ResetFormState = { status: "idle" };

interface Props {
  token: string;
}

export function ResetForm({ token }: Props) {
  const [state, formAction] = useActionState(resetPasswordAction, initialState);
  const errors = state.fieldErrors;

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={token} />

      {state.status === "error" && state.message && <Alert>{state.message}</Alert>}

      <Field
        id="reset-password"
        label="Password baru"
        error={errors?.password?.[0]}
        hint="Minimal 8 karakter."
      >
        <Input
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Field>

      <Field id="reset-confirm" label="Ulangi password baru" error={errors?.confirmPassword?.[0]}>
        <Input
          type="password"
          name="confirmPassword"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Field>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" fullWidth disabled={pending}>
      {pending ? "Menyimpan…" : "Ganti password"}
    </Button>
  );
}
