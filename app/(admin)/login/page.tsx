import type { Metadata } from "next";
import { authStatus, signIn } from "@/auth";

export const metadata: Metadata = {
  title: "Masuk Admin",
  robots: { index: false, follow: false },
};

interface LoginPageProps {
  searchParams: Promise<{ from?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { from, error } = await searchParams;
  const redirectTo = from && from.startsWith("/admin") ? from : "/admin";

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm">
        <h1 className="font-[var(--font-display)] text-2xl text-gray-900 mb-2">
          Admin Sakola Kembara
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          Masuk dengan akun organisasi (@sakolakembara.org).
        </p>

        {error === "domain" && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            Akun ini bukan akun organisasi Sakola Kembara.
          </div>
        )}
        {error && error !== "domain" && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            Gagal masuk. Silakan coba lagi.
          </div>
        )}

        {authStatus.entraConfigured && (
          <form
            action={async () => {
              "use server";
              await signIn("microsoft-entra-id", { redirectTo });
            }}
          >
            <button
              type="submit"
              className="w-full px-6 py-3 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
            >
              Masuk dengan Microsoft
            </button>
          </form>
        )}

        {authStatus.devProviderActive && (
          <>
            {authStatus.entraConfigured && (
              <div className="text-center text-xs text-gray-400 my-4 tracking-wider">
                — DEV ONLY —
              </div>
            )}
            <form
              className="space-y-3"
              action={async (formData: FormData) => {
                "use server";
                await signIn("dev", {
                  email: formData.get("email"),
                  redirectTo,
                });
              }}
            >
              <input
                type="email"
                name="email"
                required
                placeholder="admin@sakolakembara.org"
                autoComplete="email"
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-lg focus:border-primary-blue focus:outline-none"
              />
              <button
                type="submit"
                className="w-full px-6 py-3 bg-gray-900 text-white font-semibold rounded-lg hover:bg-gray-800 transition-colors"
              >
                Masuk (dev)
              </button>
              <p className="text-xs text-gray-500">
                Email harus berakhir{" "}
                <span className="font-mono">@sakolakembara.org</span> dan sudah
                diseed di tabel <span className="font-mono">admin_users</span>{" "}
                (jalankan{" "}
                <span className="font-mono">npm run seed:admin -- email@…</span>
                ).
              </p>
            </form>
          </>
        )}

        {!authStatus.entraConfigured && !authStatus.devProviderActive && (
          <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-3 py-3 text-sm text-yellow-800">
            <p className="font-semibold mb-1">Belum ada provider auth aktif.</p>
            <p>
              Atur <span className="font-mono">AUTH_MICROSOFT_ENTRA_ID_*</span>{" "}
              di <span className="font-mono">.env.local</span>, atau aktifkan{" "}
              <span className="font-mono">AUTH_DEV_PROVIDER_ENABLED=true</span>{" "}
              untuk sign-in dev.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
