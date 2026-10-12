import { Button } from "@/components/ui/button";
import { PageHeader } from "~/components/PageHeader";

/** 403, inside the shell: the account is signed in but may not open this area. */
export function ForbiddenPage() {
  return (
    <div className="p-6 md:p-10">
      <PageHeader title="Akses ditolak">
        <p className="text-gray-600">Akun ini tidak memiliki akses ke halaman tersebut.</p>
      </PageHeader>
      <Button href="/" variant="neutral">
        Kembali ke Dashboard
      </Button>
    </div>
  );
}
