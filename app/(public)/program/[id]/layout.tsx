import type { Metadata } from "next";
import { programs } from "@/lib/data";
import { buildPageMetadata, jsonLdScript, programJsonLd } from "@/lib/seo";

interface ProgramLayoutProps {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const program = programs.find((p) => p.id === id);
  if (!program) {
    return { title: "Program tidak ditemukan" };
  }
  return buildPageMetadata({
    title: `Program ${program.title}`,
    description: program.description,
    path: `/program/${id}`,
    ogImage: program.image.src,
  });
}

export default async function ProgramLayout({ params, children }: ProgramLayoutProps) {
  const { id } = await params;
  const program = programs.find((p) => p.id === id);

  return (
    <>
      {program && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(programJsonLd(program)) }}
        />
      )}
      {children}
    </>
  );
}
