"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { registerStudent, type RegisterFormState } from "./actions";

const initialState: RegisterFormState = { status: "idle" };

interface Props {
  from: string | null;
}

export function RegisterForm({ from }: Props) {
  const [state, formAction] = useActionState(registerStudent, initialState);
  const errors = state.fieldErrors;

  return (
    <form action={formAction} className="space-y-5">
      {from && <input type="hidden" name="from" value={from} />}
      {/* Honeypot — hidden from humans, filled by dumb bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      {state.status === "error" && state.message && <Alert>{state.message}</Alert>}

      <Field id="reg-name" label="Nama lengkap" error={errors?.name?.[0]}>
        <Input
          type="text"
          name="name"
          required
          autoComplete="name"
          placeholder="Contoh: Dadi Dinan Haris"
        />
      </Field>

      <Field id="reg-email" label="Email" error={errors?.email?.[0]}>
        <Input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="nama@contoh.com"
        />
      </Field>

      <Field
        id="reg-password"
        label="Password"
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

      <Field id="reg-confirm" label="Ulangi password" error={errors?.confirmPassword?.[0]}>
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
      {pending ? "Membuat akun…" : "Daftar"}
    </Button>
  );
}
