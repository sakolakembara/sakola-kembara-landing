"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  requestPasswordResetAction,
  type ForgotFormState,
} from "./actions";

const initialState: ForgotFormState = { status: "idle" };

export function ForgotForm() {
  const [state, formAction] = useActionState(
    requestPasswordResetAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-5">
      {/* Honeypot — hidden from humans. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      {state.status === "success" && state.message && (
        <Alert tone="success">{state.message}</Alert>
      )}
      {state.status === "error" && state.message && <Alert>{state.message}</Alert>}

      <Field id="forgot-email" label="Email">
        <Input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="nama@contoh.com"
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
      {pending ? "Mengirim…" : "Kirim tautan reset"}
    </Button>
  );
}
