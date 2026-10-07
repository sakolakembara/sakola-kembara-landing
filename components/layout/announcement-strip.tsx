import Link from "next/link";
import { AlertTriangle, Info, Megaphone } from "lucide-react";
import { Container } from "@/components/ui/container";
import type { Announcement } from "@/lib/db/schema";

const STYLES = {
  info: {
    bg: "bg-blue-50 border-blue-200",
    text: "text-blue-900",
    cta: "bg-blue-900 text-white hover:bg-blue-800",
    Icon: Info,
  },
  warning: {
    bg: "bg-amber-50 border-amber-200",
    text: "text-amber-900",
    cta: "bg-amber-900 text-white hover:bg-amber-800",
    Icon: Megaphone,
  },
  urgent: {
    bg: "bg-red-50 border-red-200",
    text: "text-red-900",
    cta: "bg-red-900 text-white hover:bg-red-800",
    Icon: AlertTriangle,
  },
} as const;

export function AnnouncementStrip({ announcement }: { announcement: Announcement }) {
  const style = STYLES[announcement.severity];
  const Icon = style.Icon;
  const hasCta = announcement.ctaLabel && announcement.ctaUrl;
  const isExternal = announcement.ctaUrl?.startsWith("http");

  return (
    <div
      role="status"
      className={`border-b ${style.bg} ${style.text}`}
    >
      <Container className="py-2.5 flex items-center gap-3 text-sm">
        <Icon size={16} className="shrink-0" aria-hidden />
        <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <strong className="font-semibold">{announcement.title}</strong>
          <span className="opacity-90 truncate">{announcement.body}</span>
        </div>
        {hasCta && announcement.ctaUrl && (
          <Link
            href={announcement.ctaUrl}
            target={isExternal ? "_blank" : undefined}
            rel={isExternal ? "noopener noreferrer" : undefined}
            className={`shrink-0 px-3 py-1 text-xs font-semibold rounded-full transition-colors ${style.cta}`}
          >
            {announcement.ctaLabel}
          </Link>
        )}
      </Container>
    </div>
  );
}
