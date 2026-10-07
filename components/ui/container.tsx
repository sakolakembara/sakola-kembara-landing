import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const containerVariants = cva("mx-auto w-full px-6", {
  variants: {
    size: {
      page: "max-w-[1200px]",
      focused: "max-w-[1000px]",
      reading: "max-w-[800px]",
    },
  },
  defaultVariants: { size: "page" },
});

/** Horizontal page container (atom): 1200 default, 1000 focused, 800 reading (SAKEM-031 D4). */
export function Container({
  size,
  as: Tag = "div",
  className,
  ...rest
}: VariantProps<typeof containerVariants> & {
  as?: "div" | "section" | "header" | "footer" | "main" | "nav";
} & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={cn(containerVariants({ size }), className)} {...rest} />;
}
