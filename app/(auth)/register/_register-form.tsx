"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { registerStudent, type RegisterFormState } from "./actions";

const initialState: RegisterFormState = { status: "idle" };

const INPUT =
  "w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none text-sm";

interface Props {
  from: string | null;
}

export function RegisterForm({ from }: Props) {
  const [state, formAction] = useActionState(registerStudent, initialState);

  return (
    <form action={formAction} className="space-y-3">
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

      {state.status === "error" && state.message && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.message}
        </div>
      )}

      <Field
        id="reg-name"
        label="Nama lengkap"
        errors={state.fieldErrors?.name}
      >
        <input
          id="reg-name"
          type="text"
          name="name"
          required
          autoComplete="name"
          placeholder="Contoh: Dadi Dinan Haris"
          className={INPUT}
        />
      </Field>

      <Field
        id="reg-email"
        label="Email"
        errors={state.fieldErrors?.email}
      >
        <input
          id="reg-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="nama@contoh.com"
          className={INPUT}
        />
      </Field>

      <Field
        id="reg-password"
        label="Password"
        errors={state.fieldErrors?.password}
        hint="Minimal 8 karakter."
      >
        <input
          id="reg-password"
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={INPUT}
        />
      </Field>

      <Field
        id="reg-confirm"
        label="Ulangi password"
        errors={state.fieldErrors?.confirmPassword}
      >
        <input
          id="reg-confirm"
          type="password"
          name="confirmPassword"
          required
          minLength={8}
          autoComplete="new-password"
          className={INPUT}
        />
      </Field>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full px-6 py-2.5 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm"
    >
      {pending ? "Membuat akun…" : "Daftar"}
    </button>
  );
}

function Field({
  id,
  label,
  errors,
  hint,
  children,
}: {
  id: string;
  label: string;
  errors?: string[];
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700 mb-1">
        {label}
      </label>
      {children}
      {hint && !errors?.length && (
        <p className="text-[11px] text-gray-500 mt-1">{hint}</p>
      )}
      {errors?.[0] && <p className="text-xs text-red-600 mt-1">{errors[0]}</p>}
    </div>
  );
}
