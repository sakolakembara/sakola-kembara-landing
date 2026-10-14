import { api } from "@shared/spa/api";
import { AuthShell, AUTH_LINK } from "@shared/spa/AuthShell";
import { RESET_REQUESTED_MESSAGE, resetRequestFailureMessage } from "@shared/spa/auth-errors";
import { TurnstileWidget } from "@shared/spa/TurnstileWidget";
import { useTurnstile } from "@shared/spa/turnstile";
import { validateForgot } from "@shared/spa/validation";
import { type FormEvent, useRef, useState } from "react";
import { Link } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { focusFirstInvalid, useAutoFocus, usePageTitle, useSubmitLock } from "~/lib/hooks";
import { ENDPOINTS, RESET_PAGE } from "~/lib/paths";
import { usePublicConfig } from "~/lib/public-config";

/** `/forgot-password`: asks for a reset link (the legacy copy). The answer reads the same whether or not the address has an account. */
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

    // Honeypot: a person never sees this field. A bot that filled it gets the same answer as everyone else and nothing is sent.
    if (String(data.get("website") ?? "") !== "") {
      setNotice({ tone: "success", text: RESET_REQUESTED_MESSAGE });
      return;
    }

    // The button is disabled until the check has a token; this covers a submit that does not come from it (a script).
    if (turnstile.blocked) return;

    void run(async () => {
      setNotice(null);
      const result = await api(ENDPOINTS.requestReset, {
        method: "POST",
        json: { email: checked.values.email, redirectTo: RESET_PAGE },
        // Spent by this request whatever the answer (the page stays open and may send again); take() starts the next challenge.
        turnstileToken: turnstile.take(),
      });
      // Success reads the same whether or not the address has an account.
      setNotice(result.ok ? { tone: "success", text: RESET_REQUESTED_MESSAGE } : { tone: "danger", text: resetRequestFailureMessage(result) });
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
          <Input ref={emailInput} type="email" name="email" required autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="nama@contoh.com" />
        </Field>

        <TurnstileWidget turnstile={turnstile} />

        <Button type="submit" size="lg" fullWidth disabled={pending || turnstile.blocked}>
          {pending ? "Mengirim…" : turnstile.checking ? "Memeriksa…" : "Kirim tautan reset"}
        </Button>
      </form>
    </AuthShell>
  );
}
