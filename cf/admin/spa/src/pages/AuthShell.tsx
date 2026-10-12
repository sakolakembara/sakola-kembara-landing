import type { ReactNode } from "react";

/** The centered card the legacy /login uses (app/(auth)/login/page.tsx). */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="inline-block font-[family-name:var(--font-display)] text-2xl text-gray-900">Sakola Kembara</p>
          <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-8 space-y-6">
          <h1 className="font-[family-name:var(--font-display)] text-xl text-gray-900">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}
