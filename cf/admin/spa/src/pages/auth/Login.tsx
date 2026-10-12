import { type FormEvent, type SVGProps, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api } from "~/lib/api";
import { GENERIC_SIGN_IN_ERROR, queryErrorMessage, signInFailureMessage } from "~/lib/auth-errors";
import { focusFirstInvalid, useAutoFocus, usePageTitle, useSubmitLock } from "~/lib/hooks";
import { safeFrom } from "~/lib/guard";
import { type FieldErrors, validateLogin } from "~/lib/validation";
import { AuthShell } from "./AuthShell";

// Where the link in a verification email lands. Better Auth verifies on its
// own endpoint, then redirects here (see pages/auth/VerifyEmail.tsx). It is sent
// with the sign-in because an unverified account gets a fresh link right then.
const VERIFY_CALLBACK = "/verify-email?status=success";

// Google's "G" (from the login-2 block), drawn in the text colour.
function GoogleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg fill="currentColor" viewBox="0 0 24 24" {...props}>
      <path d="M3.06364 7.50914C4.70909 4.24092 8.09084 2 12 2C14.6954 2 16.959 2.99095 18.6909 4.60455L15.8227 7.47274C14.7864 6.48185 13.4681 5.97727 12 5.97727C9.39542 5.97727 7.19084 7.73637 6.40455 10.1C6.2045 10.7 6.09086 11.3409 6.09086 12C6.09086 12.6591 6.2045 13.3 6.40455 13.9C7.19084 16.2636 9.39542 18.0227 12 18.0227C13.3454 18.0227 14.4909 17.6682 15.3864 17.0682C16.4454 16.3591 17.15 15.3 17.3818 14.05H12V10.1818H21.4181C21.5364 10.8363 21.6 11.5182 21.6 12.2273C21.6 15.2727 20.5091 17.8363 18.6181 19.5773C16.9636 21.1046 14.7 22 12 22C8.09084 22 4.70909 19.7591 3.06364 16.4909C2.38638 15.1409 2 13.6136 2 12C2 10.3864 2.38638 8.85911 3.06364 7.50914Z" />
    </svg>
  );
}

export function LoginPage() {
  usePageTitle("Masuk");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = safeFrom(params.get("from"));
  const errorParam = params.get("error");

  const [message, setMessage] = useState<string | null>(errorParam ? queryErrorMessage(errorParam) : null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<"email" | "password">>({});
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const { pending, run } = useSubmitLock();
  const form = useRef<HTMLFormElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  useAutoFocus(emailInput);

  useEffect(() => {
    let cancelled = false;
    api<{ google: boolean }>("/api/config").then((result) => {
      if (!cancelled && result.ok) setGoogleEnabled(result.data.google === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const checked = validateLogin({ email: String(data.get("email") ?? ""), password: String(data.get("password") ?? "") });
    if (!checked.ok) {
      setMessage(null);
      setFieldErrors(checked.errors);
      focusFirstInvalid(form.current, ["email", "password"], checked.errors);
      return;
    }
    setFieldErrors({});
    void run(async () => {
      setMessage(null);
      const result = await api("/api/auth/sign-in/email", {
        method: "POST",
        json: { ...checked.values, callbackURL: VERIFY_CALLBACK },
      });
      if (result.ok) {
        navigate(from ?? "/", { replace: true });
        return;
      }
      setMessage(signInFailureMessage(result));
    });
  }

  function google() {
    void run(async () => {
      setMessage(null);
      const result = await api<{ url?: string }>("/api/auth/sign-in/social", {
        method: "POST",
        json: { provider: "google", callbackURL: from ?? "/" },
      });
      if (result.ok && result.data.url) window.location.assign(result.data.url);
      else setMessage(result.ok ? GENERIC_SIGN_IN_ERROR : signInFailureMessage(result));
    });
  }

  return (
    <AuthShell
      title="Selamat datang kembali"
      subtitle="Masuk untuk mengelola konten Sakola Kembara."
      description="Gunakan akun Google atau email + password kamu untuk melanjutkan."
    >
      {params.get("reset") === "1" && !errorParam && (
        <Alert tone="success">Password berhasil diganti. Silakan masuk dengan password baru.</Alert>
      )}
      {message && <Alert>{message}</Alert>}

      <form ref={form} onSubmit={submit} noValidate aria-busy={pending} className="space-y-4">
        <Field id="login-email" label="Email" error={fieldErrors.email}>
          <Input
            ref={emailInput}
            type="email"
            name="email"
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="nama@contoh.com"
          />
        </Field>
        <Field
          id="login-password"
          label="Password"
          error={fieldErrors.password}
          labelAside={
            <Link to="/forgot-password" className="text-xs text-primary-blue font-semibold hover:underline">
              Lupa password?
            </Link>
          }
        >
          <Input type="password" name="password" required autoComplete="current-password" />
        </Field>
        <Button type="submit" fullWidth disabled={pending}>
          {pending ? "Memproses…" : "Masuk"}
        </Button>
      </form>
      {googleEnabled && (
        <>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-gray-400 uppercase tracking-wider">atau</span>
            </div>
          </div>
          <Button type="button" variant="neutral" fullWidth disabled={pending} onClick={google}>
            <GoogleIcon className="size-5" aria-hidden />
            Masuk dengan Google
          </Button>
        </>
      )}
    </AuthShell>
  );
}
