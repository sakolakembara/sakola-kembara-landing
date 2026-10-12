import { type FormEvent, useRef, useState } from "react";
import { Link } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { TurnstileWidget } from "~/components/TurnstileWidget";
import { api } from "~/lib/api";
import { RESET_REQUESTED_MESSAGE, resetRequestFailureMessage } from "~/lib/auth-errors";
import { focusFirstInvalid, useAutoFocus, usePageTitle, useSubmitLock } from "~/lib/hooks";
import { usePublicConfig } from "~/lib/public-config";
import { useTurnstile } from "~/lib/turnstile";
import { validateForgot } from "~/lib/validation";
import { AUTH_LINK, AuthShell } from "./AuthShell";

// Where the link in the reset email lands, with ?token= (or ?error= when the
// link is spent or expired). Better Auth redirects there after checking it.
const RESET_PAGE = "/reset-password";

export function ForgotPasswordPage() {
  usePageTitle("Lupa Password");
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>();
  const turnstile = useTurnstile("forgot-password", usePublicConfig().turnstileSiteKey);
  const { pending, run } = useSubmitLock();
  const form = useRef<HTMLFormElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  useAutoFocus(emailInput);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const checked = validateForgot({ email: String(data.get("email") ?? "") });
    if (!checked.ok) {
      setNotice(null);
      setEmailError(checked.errors.email);
      focusFirstInvalid(form.current, ["email"], checked.errors);
      return;
    }
    setEmailError(undefined);

    // Honeypot: a person never sees this field. A bot that filled it gets the
    // same answer as everyone else and nothing is sent.
    if (String(data.get("website") ?? "") !== "") {
      setNotice({ tone: "success", text: RESET_REQUESTED_MESSAGE });
      return;
    }

    // The button is disabled until the check has a token; this covers a submit that does not come from it (a script).
    if (turnstile.blocked) return;

    void run(async () => {
      setNotice(null);
      const result = await api("/api/auth/request-password-reset", {
        method: "POST",
        json: { email: checked.values.email, redirectTo: RESET_PAGE },
        // Spent by this request whatever the answer (the page stays open and may send again); take() starts the next challenge.
        turnstileToken: turnstile.take(),
      });
      // Success reads the same whether or not the address has an account.
      setNotice(
        result.ok ? { tone: "success", text: RESET_REQUESTED_MESSAGE } : { tone: "danger", text: resetRequestFailureMessage(result) },
      );
    });
  }

  return (
    <AuthShell
      title="Lupa password?"
      description="Masukkan email akun kamu. Kami akan mengirim tautan untuk mengatur ulang password ke inbox tersebut."
      footer={
        <>
          Ingat lagi password kamu?{" "}
          <Link to="/login" className={AUTH_LINK}>
            Kembali ke halaman masuk
          </Link>
        </>
      }
    >
      <form ref={form} onSubmit={submit} noValidate aria-busy={pending} className="space-y-5">
        {/* Honeypot, hidden from people and from assistive technology. */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

        <Field id="forgot-email" label="Email" error={emailError}>
          <Input
            ref={emailInput}
            type="email"
            name="email"
            required
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="nama@contoh.com"
          />
        </Field>

        <TurnstileWidget turnstile={turnstile} />

        <Button type="submit" size="lg" fullWidth disabled={pending || turnstile.blocked}>
          {pending ? "Mengirim…" : turnstile.checking ? "Memeriksa…" : "Kirim tautan reset"}
        </Button>
      </form>
    </AuthShell>
  );
}
