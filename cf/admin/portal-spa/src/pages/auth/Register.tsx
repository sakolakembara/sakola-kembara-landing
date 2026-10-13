import { api } from "@shared/spa/api";
import { AuthShell, AUTH_LINK } from "@shared/spa/AuthShell";
import { GENERIC_SIGN_IN_ERROR, signInFailureMessage } from "@shared/spa/auth-errors";
import { GoogleButton, OrDivider } from "@shared/spa/GoogleButton";
import { TurnstileWidget } from "@shared/spa/TurnstileWidget";
import { useTurnstile } from "@shared/spa/turnstile";
import { PASSWORD_MIN } from "@shared/spa/validation";
import { type FormEvent, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ResendVerification } from "~/components/ResendVerification";
import { portalSafeFrom } from "~/lib/guard";
import { focusFirstInvalid, useAutoFocus, usePageTitle, useSubmitLock } from "~/lib/hooks";
import { ENDPOINTS, googleCallback, REGISTER_CALLBACK } from "~/lib/paths";
import { usePublicConfig } from "~/lib/public-config";
import { REGISTERED_HEADLINE, REGISTERED_MESSAGE, type RegisterField, registerFailure, validateRegister } from "~/lib/register";

const FIELD_ORDER: readonly RegisterField[] = ["name", "email", "password", "confirm"];

/**
 * `/register`: a student makes an account, in the admin's login layout (a narrow column, no card, one heading, the form
 * on top, then the "atau" rule and the Google button when Google is on). The copy is the legacy page's
 * (app/(auth)/register/page.tsx). The Worker creates the account unverified, sends the verification email and answers
 * the same for every address, so the page after a send says the same for every address too: "Cek email kamu", with
 * "Kirim ulang tautan". Nobody is signed in by registering; they sign in once the address is verified.
 */
export function RegisterPage() {
  usePageTitle("Daftar Akun");
  const [params] = useSearchParams();
  const from = portalSafeFrom(params.get("from"));

  const [registered, setRegistered] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RegisterField, string>>>({});
  const { google: googleEnabled, turnstileSiteKey } = usePublicConfig();
  const turnstile = useTurnstile("register", turnstileSiteKey);
  const { pending, run } = useSubmitLock();
  const form = useRef<HTMLFormElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  useAutoFocus(nameInput);

  const signInLink = (
    <Link to={from ? `/login?from=${encodeURIComponent(from)}` : "/login"} className={AUTH_LINK}>
      Masuk di sini
    </Link>
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const checked = validateRegister({
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
      confirm: String(data.get("confirm") ?? ""),
    });
    if (!checked.ok) {
      setMessage(null);
      setFieldErrors(checked.errors);
      focusFirstInvalid(form.current, FIELD_ORDER, checked.errors);
      return;
    }
    setFieldErrors({});

    // Honeypot: a person never sees this field. A bot that filled it gets the same answer as everyone else and nothing is sent.
    if (String(data.get("website") ?? "") !== "") {
      setRegistered(checked.values.email);
      return;
    }

    // The button is disabled until the check has a token; this covers a submit that does not come from it (a script).
    if (turnstile.blocked) return;

    void run(async () => {
      setMessage(null);
      const result = await api(ENDPOINTS.register, {
        method: "POST",
        json: { ...checked.values, callbackURL: REGISTER_CALLBACK },
        // Spent by this request whatever the answer; take() starts the next challenge.
        turnstileToken: turnstile.take(),
      });
      if (result.ok) {
        setRegistered(checked.values.email);
        return;
      }
      const failure = registerFailure(result);
      setMessage(failure.message);
      if (failure.fields && Object.keys(failure.fields).length > 0) {
        setFieldErrors(failure.fields);
        focusFirstInvalid(form.current, FIELD_ORDER, failure.fields);
      }
    });
  }

  function google() {
    void run(async () => {
      setMessage(null);
      const result = await api<{ url?: string }>(ENDPOINTS.signInSocial, {
        method: "POST",
        json: { provider: "google", callbackURL: googleCallback(from) },
      });
      if (result.ok && result.data.url) window.location.assign(result.data.url);
      else setMessage(result.ok ? GENERIC_SIGN_IN_ERROR : signInFailureMessage(result));
    });
  }

  if (registered) {
    return (
      <AuthShell title={REGISTERED_HEADLINE} description={REGISTERED_MESSAGE} footer={<>Sudah verifikasi email? {signInLink}</>}>
        <ResendVerification email={registered} callbackURL={REGISTER_CALLBACK} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Daftar akun baru"
      description="Data pendaftaran kamu akan tersimpan pada akun ini agar bisa dibuka kembali kapan saja."
      footer={<>Sudah punya akun? {signInLink}</>}
    >
      {message && <Alert>{message}</Alert>}

      <form ref={form} onSubmit={submit} noValidate aria-busy={pending} className="space-y-4">
        {/* Honeypot, hidden from people and from assistive technology. */}
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

        <Field id="reg-name" label="Nama lengkap" error={fieldErrors.name}>
          <Input ref={nameInput} type="text" name="name" required autoComplete="name" placeholder="Contoh: Dadi Dinan Haris" />
        </Field>
        <Field id="reg-email" label="Email" error={fieldErrors.email}>
          <Input type="email" name="email" required autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="nama@contoh.com" />
        </Field>
        <Field id="reg-password" label="Password" error={fieldErrors.password} hint={`Minimal ${PASSWORD_MIN} karakter.`}>
          <Input type="password" name="password" required autoComplete="new-password" />
        </Field>
        <Field id="reg-confirm" label="Ulangi password" error={fieldErrors.confirm}>
          <Input type="password" name="confirm" required autoComplete="new-password" />
        </Field>
        <TurnstileWidget turnstile={turnstile} />
        <Button type="submit" fullWidth disabled={pending || turnstile.blocked}>
          {pending ? "Membuat akun…" : turnstile.checking ? "Memeriksa…" : "Daftar"}
        </Button>
      </form>
      {googleEnabled && (
        <>
          <OrDivider />
          <GoogleButton disabled={pending} onClick={google}>
            Daftar dengan Google
          </GoogleButton>
        </>
      )}
    </AuthShell>
  );
}
