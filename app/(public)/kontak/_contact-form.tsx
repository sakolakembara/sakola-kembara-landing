"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Send } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import {
  submitContactMessage,
  type ContactFormState,
} from "./actions";

const initialState: ContactFormState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      <Send size={18} />
      {pending ? "Mengirim..." : "Kirim Pesan"}
    </Button>
  );
}

export function ContactForm() {
  const [state, formAction] = useActionState(
    submitContactMessage,
    initialState,
  );

  if (state.status === "success") {
    return (
      <div className="bg-success-bg border border-success-border rounded-2xl p-8 text-center">
        <div className="w-14 h-14 bg-success-fg rounded-full mx-auto mb-4 flex items-center justify-center">
          <CheckCircle2 className="text-white" size={32} />
        </div>
        <h3 className="font-[family-name:var(--font-display)] text-2xl text-gray-900 mb-2">
          Pesan Terkirim
        </h3>
        <p className="text-gray-700 max-w-md mx-auto">
          {state.message ||
            "Pesan kamu sudah kami terima. Tim kami akan menghubungi via email."}
        </p>
      </div>
    );
  }

  const errors = state.fieldErrors;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.status === "error" && state.message && <Alert>{state.message}</Alert>}

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
        <Field id="fullName" label="Nama Lengkap" required error={errors?.fullName?.[0]}>
          <Input
            type="text"
            name="fullName"
            required
            placeholder="Masukkan nama Anda"
          />
        </Field>
        <Field id="email" label="Email" required error={errors?.email?.[0]}>
          <Input
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="email@example.com"
          />
        </Field>
      </div>

      <Field id="subject" label="Subjek" required error={errors?.subject?.[0]}>
        <Select name="subject" required defaultValue="">
          <option value="" disabled>
            Pilih subjek
          </option>
          <option value="partnership">Kerjasama/Partnership</option>
          <option value="donation">Seputar Donasi</option>
          <option value="other">Lainnya</option>
        </Select>
      </Field>

      <Field id="message" label="Pesan" required error={errors?.message?.[0]}>
        <Textarea
          name="message"
          required
          rows={5}
          placeholder="Tulis pesan Anda di sini..."
        />
      </Field>

      <div className="pt-1">
        <SubmitButton />
      </div>
    </form>
  );
}
