import { type FormEvent, useEffect, useRef, useState } from "react";
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

      {googleEnabled && (
        <>
          <Button type="button" variant="neutral" size="lg" fullWidth disabled={pending} onClick={google}>
            Masuk dengan Google
          </Button>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-3 text-gray-400 uppercase tracking-wider">atau</span>
            </div>
          </div>
        </>
      )}

      <form ref={form} onSubmit={submit} noValidate aria-busy={pending} className="space-y-5">
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
        <Button type="submit" size="lg" fullWidth disabled={pending}>
          {pending ? "Memproses…" : "Masuk"}
        </Button>
      </form>
    </AuthShell>
  );
}
