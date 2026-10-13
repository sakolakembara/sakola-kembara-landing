import { api } from "@shared/spa/api";
import { AuthShell, AUTH_LINK } from "@shared/spa/AuthShell";
import { GENERIC_SIGN_IN_ERROR, queryErrorMessage, signInFailureMessage, verifyOutcome } from "@shared/spa/auth-errors";
import { GoogleButton, OrDivider } from "@shared/spa/GoogleButton";
import { TurnstileWidget } from "@shared/spa/TurnstileWidget";
import { useTurnstile } from "@shared/spa/turnstile";
import { type FieldErrors, validateLogin } from "@shared/spa/validation";
import { type FormEvent, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ResendVerification } from "~/components/ResendVerification";
import { portalSafeFrom } from "~/lib/guard";
import { focusFirstInvalid, useAutoFocus, usePageTitle, useSubmitLock } from "~/lib/hooks";
import { ENDPOINTS, googleCallback, REGISTER_CALLBACK, VERIFY_CALLBACK } from "~/lib/paths";
import { usePublicConfig } from "~/lib/public-config";

/**
 * `/login`: the sign-in page, in the admin's login layout (a narrow column on a plain page, no card, one heading, the
 * form on top, then the "atau" rule and the Google button when Google is on). The Indonesian copy is the legacy
 * portal's (app/(auth)/login/page.tsx).
 *
 * An account whose address is not verified cannot sign in (`403 EMAIL_NOT_VERIFIED`, and the Worker sends a fresh
 * link at once): the page then says so and offers "Kirim ulang tautan", instead of a form that would fail again.
 */
export function LoginPage() {
  usePageTitle("Masuk");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const from = portalSafeFrom(params.get("from"));
  const errorParam = params.get("error");

  const [message, setMessage] = useState<string | null>(null);
  const [unverified, setUnverified] = useState<{ email: string; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<"email" | "password">>({});
  const { google: googleEnabled, turnstileSiteKey } = usePublicConfig();
  const turnstile = useTurnstile("login", turnstileSiteKey);
  const { pending, run } = useSubmitLock();
  const form = useRef<HTMLFormElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  useAutoFocus(emailInput);

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
    // The button is disabled until the check has a token; this covers a submit that does not come from it (a script).
    if (turnstile.blocked) return;
    void run(async () => {
      setMessage(null);
      const result = await api(ENDPOINTS.signIn, {
        method: "POST",
        json: { ...checked.values, callbackURL: VERIFY_CALLBACK },
        // Spent by this request whatever the answer; take() starts the next challenge.
        turnstileToken: turnstile.take(),
      });
      if (result.ok) {
        navigate(from ?? "/", { replace: true });
        return;
      }
      if (result.code === "EMAIL_NOT_VERIFIED") {
        setUnverified({ email: checked.values.email, message: signInFailureMessage(result) });
        return;
      }
      setMessage(signInFailureMessage(result));
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

  if (unverified) {
    return (
      <AuthShell
        title="Verifikasi email kamu"
        footer={
          <button type="button" className={AUTH_LINK} onClick={() => setUnverified(null)}>
            Kembali ke halaman masuk
          </button>
        }
      >
        <Alert tone="warning">{unverified.message}</Alert>
        <ResendVerification email={unverified.email} callbackURL={REGISTER_CALLBACK} />
      </AuthShell>
    );
  }

  // What the page says before anything is typed: where a link of an email or of Google sent the student back with.
  const verified = params.get("verified") === "1";
  const verification = verified ? verifyOutcome({ status: errorParam ? null : "success", error: errorParam }) : null;

  return (
    <AuthShell
      title="Selamat datang kembali"
      description="Masuk untuk mendaftar sebagai calon siswa Sakola Kembara."
      footer={
        <>
          Belum punya akun?{" "}
          <Link to={from ? `/register?from=${encodeURIComponent(from)}` : "/register"} className={AUTH_LINK}>
            Daftar di sini
          </Link>
        </>
      }
    >
      {params.get("reset") === "1" && !errorParam && <Alert tone="success">Password berhasil diganti. Silakan masuk dengan password baru.</Alert>}
      {verification ? (
        <Alert tone={verification.ok ? "success" : "danger"}>{verification.ok ? `${verification.headline}. Silakan masuk untuk melanjutkan.` : verification.body}</Alert>
      ) : (
        errorParam && <Alert>{queryErrorMessage(errorParam)}</Alert>
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
            <Link to="/forgot-password" className="text-xs font-semibold text-primary-blue hover:underline">
              Lupa password?
            </Link>
          }
        >
          <Input type="password" name="password" required autoComplete="current-password" />
        </Field>
        <TurnstileWidget turnstile={turnstile} />
        <Button type="submit" fullWidth disabled={pending || turnstile.blocked}>
          {pending ? "Memproses…" : turnstile.checking ? "Memeriksa…" : "Masuk"}
        </Button>
      </form>
      {googleEnabled && (
        <>
          <OrDivider />
          <GoogleButton disabled={pending} onClick={google}>
            Masuk dengan Google
          </GoogleButton>
        </>
      )}
    </AuthShell>
  );
}
