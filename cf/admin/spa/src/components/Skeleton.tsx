import { cn } from "@/lib/cn";

/**
 * A grey block that pulses where content is going to be. Decorative: whoever shows one also has a status text for
 * the people who cannot see it ("Memuat data..."). It is darker than the page behind it on purpose: a pulse between
 * two almost equal greys reads as nothing happening.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-gray-200 motion-reduce:animate-none", className)} />;
}
