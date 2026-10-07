import { notFound } from "next/navigation";
import { programs } from "@/lib/data";
import { getProgramGallery } from "@/lib/gallery";
import ProgramContent from "./_program-content";

interface ProgramPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Server wrapper. It answers 404 for an unknown program, reads the program's
 * photo folder off disk and hands both to the client component, which cannot
 * touch the filesystem itself. Mirrors the page/_content split used by /tim,
 * /laporan and /blog.
 */
export default async function ProgramPage({ params }: ProgramPageProps) {
  const { id } = await params;
  const program = programs.find((p) => p.id === id);
  if (!program) notFound();
  const gallery = await getProgramGallery(id);

  return <ProgramContent program={program} gallery={gallery} />;
}
