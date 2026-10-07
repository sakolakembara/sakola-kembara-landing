"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { credentialsSignIn } from "./actions";

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
    <form action={credentialsSignIn} className="space-y-5">
      {from && <input type="hidden" name="from" value={from} />}
      <Field id="cred-email" label="Email">
        <Input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="nama@contoh.com"
        />
      </Field>
      <Field
        id="cred-password"
        label="Password"
        labelAside={
          <Link
            href={
              from
                ? `/forgot-password?from=${encodeURIComponent(from)}`
                : "/forgot-password"
            }
            className="text-xs text-primary-blue font-semibold hover:underline"
          >
            Lupa password?
          </Link>
        }
      >
        <Input
          type="password"
          name="password"
          required
          autoComplete="current-password"
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
      {pending ? "Memproses…" : "Masuk"}
    </Button>
  );
}
