"use client";

import { useFormStatus } from "react-dom";
import { adminSignIn } from "./actions";

const INPUT =
  "w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none text-sm";

interface Props {
  from: string | null;
}

export function AdminCredentialsForm({ from }: Props) {
  return (
    <form action={adminSignIn} className="space-y-3">
      {from && <input type="hidden" name="from" value={from} />}
      <div>
        <label
          htmlFor="admin-email"
          className="block text-xs font-medium text-gray-700 mb-1"
        >
          Email
        </label>
        <input
          id="admin-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="admin@contoh.com"
          className={INPUT}
        />
      </div>
      <div>
        <label
          htmlFor="admin-password"
          className="block text-xs font-medium text-gray-700 mb-1"
        >
          Password
        </label>
        <input
          id="admin-password"
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className={INPUT}
        />
      </div>
      <SubmitButton />
      <p className="text-[11px] text-gray-500">
        Hanya untuk akun dengan peran admin. Password admin diseed lewat{" "}
        <span className="font-mono">npm run seed:super-admin</span> atau
        ditetapkan lewat halaman Pengaturan.
      </p>
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
      {pending ? "Memproses…" : "Masuk sebagai admin"}
    </button>
  );
}
