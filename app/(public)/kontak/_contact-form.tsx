"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Send } from "lucide-react";
import {
  submitContactMessage,
  type ContactFormState,
} from "./actions";

const initialState: ContactFormState = { status: "idle" };

const TEXT_INPUT =
  "w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-primary-blue focus:outline-none";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 px-8 py-4 bg-primary-blue text-white font-semibold rounded-xl hover:bg-primary-blue-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <Send size={18} />
      {pending ? "Mengirim..." : "Kirim Pesan"}
    </button>
  );
}

export function ContactForm() {
  const [state, formAction] = useActionState(
    submitContactMessage,
    initialState,
  );

  if (state.status === "success") {
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center">
        <div className="w-14 h-14 bg-green-600 rounded-full mx-auto mb-4 flex items-center justify-center">
          <CheckCircle2 className="text-white" size={32} />
        </div>
        <h3 className="font-[var(--font-display)] text-2xl text-gray-900 mb-2">
          Pesan Terkirim
        </h3>
        <p className="text-gray-700 max-w-md mx-auto">
          {state.message ||
            "Pesan kamu sudah kami terima. Tim kami akan menghubungi via email."}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.status === "error" && state.message && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {state.message}
        </div>
      )}

      {/* Honeypot — hidden from humans by clip + tab-out */}
      <div
        aria-hidden="true"
        className="absolute -left-[10000px] top-auto w-px h-px overflow-hidden"
      >
        <label htmlFor="website">
          Website
          <input
            id="website"
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
          />
        </label>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <label
            htmlFor="fullName"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Nama Lengkap <span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="text"
            id="fullName"
            name="fullName"
            required
            placeholder="Masukkan nama Anda"
            className={TEXT_INPUT}
          />
          {state.fieldErrors?.fullName?.[0] && (
            <p className="text-xs text-red-600 mt-1">
              {state.fieldErrors.fullName[0]}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Email <span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="email"
            id="email"
            name="email"
            required
            autoComplete="email"
            placeholder="email@example.com"
            className={TEXT_INPUT}
          />
          {state.fieldErrors?.email?.[0] && (
            <p className="text-xs text-red-600 mt-1">
              {state.fieldErrors.email[0]}
            </p>
          )}
        </div>
      </div>

      <div>
        <label
          htmlFor="subject"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Subjek <span className="text-red-500 ml-0.5">*</span>
        </label>
        <select
          id="subject"
          name="subject"
          required
          defaultValue=""
          className={`${TEXT_INPUT} bg-white`}
        >
          <option value="" disabled>
            Pilih subjek
          </option>
          <option value="partnership">Kerjasama/Partnership</option>
          <option value="donation">Seputar Donasi</option>
          <option value="other">Lainnya</option>
        </select>
        {state.fieldErrors?.subject?.[0] && (
          <p className="text-xs text-red-600 mt-1">
            {state.fieldErrors.subject[0]}
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="message"
          className="block text-sm font-medium text-gray-700 mb-2"
        >
          Pesan <span className="text-red-500 ml-0.5">*</span>
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={5}
          placeholder="Tulis pesan Anda di sini..."
          className={`${TEXT_INPUT} resize-none`}
        />
        {state.fieldErrors?.message?.[0] && (
          <p className="text-xs text-red-600 mt-1">
            {state.fieldErrors.message[0]}
          </p>
        )}
      </div>

      <div className="pt-1">
        <SubmitButton />
      </div>
    </form>
  );
}
