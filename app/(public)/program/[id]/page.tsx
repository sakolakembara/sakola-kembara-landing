import ProgramContent from "./_program-content";
import { getProgramGallery } from "@/lib/gallery";

interface ProgramPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Server wrapper. Its only job is to read the program's photo folder off disk
 * and hand the list to the client component, which cannot touch the
 * filesystem itself. Mirrors the page/_content split used by /tim, /laporan
 * and /blog.
 */
export default async function ProgramPage({ params }: ProgramPageProps) {
  const { id } = await params;
  const gallery = await getProgramGallery(id);

  return <ProgramContent programId={id} gallery={gallery} />;
}
