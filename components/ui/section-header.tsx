import { cn } from "@/lib/cn";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";

/**
 * Eyebrow + section heading + optional lead paragraph (molecule): the opening
 * of almost every section. `tone="dark"` is for navy backgrounds.
 */
export function SectionHeader({
  eyebrow,
  title,
  lead,
  tone = "light",
  align = "center",
  as = "h2",
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lead?: React.ReactNode;
  tone?: "light" | "dark";
  align?: "center" | "left";
  as?: "h1" | "h2" | "h3" | "p";
  className?: string;
}) {
  const center = align === "center";
  return (
    <div className={cn(center && "text-center", className)}>
      {eyebrow && (
        <Eyebrow tone={tone} className="mb-4">
          {eyebrow}
        </Eyebrow>
      )}
      <Heading
        level="section"
        as={as}
        className={cn(
          "max-w-[760px] text-balance",
          center && "mx-auto",
          tone === "dark" ? "text-white" : "text-gray-900",
          lead && "mb-5 md:mb-6",
        )}
      >
        {title}
      </Heading>
      {lead && (
        <p
          className={cn(
            "max-w-[600px] text-base md:text-lg",
            center && "mx-auto",
            tone === "dark" ? "text-white/80" : "text-gray-600",
          )}
        >
          {lead}
        </p>
      )}
    </div>
  );
}
