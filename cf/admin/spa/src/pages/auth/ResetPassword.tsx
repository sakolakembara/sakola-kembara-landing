import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Field, Input } from "~/components/ui/field";
import { api } from "~/lib/api";
import { RESET_LINK_INVALID_MESSAGE, RESET_LINK_MISSING_MESSAGE, resetFailure } from "~/lib/auth-errors";
import { focusFirstInvalid, useAutoFocus, usePageTitle, useSubmitLock } from "~/lib/hooks";
import { type FieldErrors, PASSWORD_MIN, validateReset } from "~/lib/validation";
import { AUTH_LINK, AuthShell } from "@shared/spa/AuthShell";

/**
 * `/reset-password?token=...`, where the link in the reset email ends up.
 * Without a token (or with `?error=`, which Better Auth adds when the link is
 * spent or expired) it explains and offers a new link instead of the form.
 */
export function ResetPasswordPage() {
  usePageTitle("Reset Password");
  const [params] = useSearchParams();
  const token = params.get("token");
  const linkError = params.get("error");

  const backToSignIn = (
    <Link to="/login" className={AUTH_LINK}>
      Kembali ke halaman masuk
    </Link>
  );

  if (!token || linkError) {
    return (
      <AuthShell title="Reset password" footer={backToSignIn}>
        <Alert tone="warning">{linkError ? RESET_LINK_INVALID_MESSAGE : RESET_LINK_MISSING_MESSAGE}</Alert>
        <Button href="/forgot-password" size="lg" fullWidth>
          Minta tautan baru
        </Button>
      </AuthShell>
    );
  }
  return <ResetForm token={token} backToSignIn={backToSignIn} />;
}

function ResetForm({ token, backToSignIn }: { token: string; backToSignIn: ReactNode }) {
  const navigate = useNavigate();
  const [message, setMessage] = useState<string | null>(null);
  const [linkExpired, setLinkExpired] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<"password" | "confirm">>({});
  const { pending, run } = useSubmitLock();
  const form = useRef<HTMLFormElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  useAutoFocus(passwordInput);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const checked = validateReset({
      password: String(data.get("password") ?? ""),
      confirm: String(data.get("confirm") ?? ""),
    });
    if (!checked.ok) {
      setMessage(null);
      setFieldErrors(checked.errors);
      focusFirstInvalid(form.current, ["password", "confirm"], checked.errors);
      return;
    }
    setFieldErrors({});
    void run(async () => {
      setMessage(null);
      const result = await api("/api/auth/reset-password", {
        method: "POST",
        json: { newPassword: checked.values.password, token },
      });
      if (result.ok) {
        // Back to sign-in; replacing the entry takes the token out of the history.
        navigate("/login?reset=1", { replace: true });
        return;
      }
      const failure = resetFailure(result);
      if (failure.linkExpired) setLinkExpired(true);
      else if (failure.field) setFieldErrors({ [failure.field]: failure.message });
      else setMessage(failure.message);
    });
  }

  if (linkExpired) {
    return (
      <AuthShell title="Reset password" footer={backToSignIn}>
        <Alert tone="warning">{RESET_LINK_INVALID_MESSAGE}</Alert>
        <Button href="/forgot-password" size="lg" fullWidth>
          Minta tautan baru
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset password"
      description="Pilih password baru. Setelah disimpan, kamu bisa masuk dengan password tersebut."
      footer={backToSignIn}
    >
      <form ref={form} onSubmit={submit} noValidate aria-busy={pending} className="space-y-5">
        {message && <Alert>{message}</Alert>}

        <Field id="reset-password" label="Password baru" error={fieldErrors.password} hint={`Minimal ${PASSWORD_MIN} karakter.`}>
          <Input ref={passwordInput} type="password" name="password" required autoComplete="new-password" />
        </Field>
        <Field id="reset-confirm" label="Ulangi password baru" error={fieldErrors.confirm}>
          <Input type="password" name="confirm" required autoComplete="new-password" />
        </Field>

        <Button type="submit" size="lg" fullWidth disabled={pending}>
          {pending ? "Menyimpan…" : "Ganti password"}
        </Button>
      </form>
    </AuthShell>
  );
}
