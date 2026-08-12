"use client";

import { useFormStatus } from "react-dom";
import { credentialsSignIn } from "./actions";

const INPUT =
  "w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none text-sm";

interface Props {
  from: string | null;
}

/**
 * Email + password sign-in for anyone who set a password on their account.
 * Deliberately not labeled as "admin" — students who registered locally use
 * the same form, and the admin path is intentionally not signposted here.
 */
export function CredentialsForm({ from }: Props) {
  return (
    <form action={credentialsSignIn} className="space-y-3">
      {from && <input type="hidden" name="from" value={from} />}
      <div>
        <label
          htmlFor="cred-email"
          className="block text-xs font-medium text-gray-700 mb-1"
        >
          Email
        </label>
        <input
          id="cred-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="nama@contoh.com"
          className={INPUT}
        />
      </div>
      <div>
        <label
          htmlFor="cred-password"
          className="block text-xs font-medium text-gray-700 mb-1"
        >
          Password
        </label>
        <input
          id="cred-password"
          type="password"
          name="password"
          required
          autoComplete="current-password"
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
      className="w-full px-6 py-2.5 bg-gray-900 text-white font-semibold rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm"
    >
      {pending ? "Memproses…" : "Masuk"}
    </button>
  );
}
