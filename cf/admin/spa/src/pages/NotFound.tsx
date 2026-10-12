import { Button } from "@/components/ui/button";
import { PageHeader } from "~/components/PageHeader";

/** 404, inside the shell. The server answers 200 for every path (SPA fallback), so this is the only 404 there is. */
export function NotFoundPage() {
  return (
    <div className="p-6 md:p-10">
      <PageHeader title="Halaman tidak ditemukan">
        <p className="text-gray-600">Halaman yang dicari tidak ada atau sudah dipindahkan.</p>
      </PageHeader>
      <Button href="/" variant="neutral">
        Kembali ke Dashboard
      </Button>
    </div>
  );
}
