import { cn } from "@/lib/cn";

// The admin's Card (cf/admin/DESIGN.md section 3, "Forms: sections as cards"): shadcn's own recipe on our tokens. A white
// box with a 1 px border and a hint of shadow; `CardHeader` holds the title and what it is for, `CardContent` the
// fields. A form screen is a stack of them (`FormSection`), an editor puts the ones that go with the text beside it.

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("flex flex-col gap-5 rounded-xl border border-border bg-card py-5 text-card-foreground shadow-xs md:py-6", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("flex flex-col gap-1 px-5 md:px-6", className)} {...props} />;
}

/** The title of a card: an `h2` by default, since a page's own title is its `h1`. */
export function CardTitle({ className, as: Tag = "h2", ...props }: React.ComponentProps<"h2"> & { as?: "h2" | "h3" }) {
  return <Tag data-slot="card-title" className={cn("text-base font-semibold leading-snug tracking-tight text-foreground", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("text-[13px] leading-relaxed text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("space-y-5 px-5 md:px-6", className)} {...props} />;
}
