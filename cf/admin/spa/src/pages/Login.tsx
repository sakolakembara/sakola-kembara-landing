import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api } from "~/lib/api";
import { AuthShell } from "./AuthShell";

// Messages are the legacy ones from app/(auth)/login/page.tsx; the unverified
// and verified lines are the only new copy (email verification is new).
const MESSAGES = {
  invalid: "Email atau password salah.",
  rateLimited: "Terlalu banyak percobaan masuk. Silakan tunggu beberapa menit lalu coba lagi.",
  unverified: "Email belum diverifikasi. Kami sudah mengirim tautan verifikasi baru ke email kamu.",
  verified: "Email terverifikasi. Silakan masuk.",
  default: "Gagal masuk. Silakan coba lagi.",
};

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [message, setMessage] = useState<string | null>(params.get("error") ? MESSAGES.default : null);
  const [pending, setPending] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    api<{ google: boolean }>("/api/config").then((result) => {
      if (result.ok) setGoogleEnabled(result.data.google);
    });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setMessage(null);
    const result = await api("/api/auth/sign-in/email", {
      method: "POST",
      json: { email: String(form.get("email")), password: String(form.get("password")) },
    });
    setPending(false);
    if (result.ok) return navigate("/announcements");
    if (result.status === 429) setMessage(MESSAGES.rateLimited);
    else if (result.code === "EMAIL_NOT_VERIFIED") setMessage(MESSAGES.unverified);
    else if (result.status === 401) setMessage(MESSAGES.invalid);
    else setMessage(MESSAGES.default);
  }

  async function google() {
    setPending(true);
    const result = await api<{ url?: string }>("/api/auth/sign-in/social", {
      method: "POST",
      json: { provider: "google", callbackURL: "/announcements" },
    });
    if (result.ok && result.data.url) window.location.assign(result.data.url);
    else {
      setPending(false);
      setMessage(MESSAGES.default);
    }
  }

  return (
    <AuthShell title="Selamat datang kembali" subtitle="Masuk untuk mengelola konten Sakola Kembara.">
      {params.get("verified") && !params.get("error") && <Alert tone="success">{MESSAGES.verified}</Alert>}
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

      <form onSubmit={submit} className="space-y-5">
        <Field id="cred-email" label="Email">
          <Input type="email" name="email" required autoComplete="email" placeholder="nama@contoh.com" />
        </Field>
        <Field id="cred-password" label="Password">
          <Input type="password" name="password" required autoComplete="current-password" />
        </Field>
        <Button type="submit" size="lg" fullWidth disabled={pending}>
          {pending ? "Memproses…" : "Masuk"}
        </Button>
      </form>
    </AuthShell>
  );
}
