"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  requestPasswordResetAction,
  type ForgotFormState,
} from "./actions";

const initialState: ForgotFormState = { status: "idle" };

const INPUT =
  "w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none text-sm";

export function ForgotForm() {
  const [state, formAction] = useActionState(
    requestPasswordResetAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-3">
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
        <div className="rounded-lg bg-secondary-green/10 border border-secondary-green/30 px-3 py-2 text-sm text-gray-800">
          {state.message}
        </div>
      )}
      {state.status === "error" && state.message && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.message}
        </div>
      )}

      <div>
        <label
          htmlFor="forgot-email"
          className="block text-xs font-medium text-gray-700 mb-1"
        >
          Email
        </label>
        <input
          id="forgot-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="nama@contoh.com"
          className={INPUT}
        />
      </div>

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
      {pending ? "Mengirim…" : "Kirim tautan reset"}
    </button>
  );
}
