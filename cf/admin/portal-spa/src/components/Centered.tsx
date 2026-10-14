import type { ReactNode } from "react";
import { Heading } from "@/components/ui/heading";

/** A status screen on its own (the session could not load, an account that is not a student): one heading, a card, no menu. */
export function Centered({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md space-y-5 rounded-2xl bg-white p-8 shadow-lg">
        <Heading level="subsection" as="h1" className="text-gray-900">
          {title}
        </Heading>
        {children}
      </div>
    </main>
  );
}
