import { useNavigate, useParams } from "react-router";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormSection, FormShell } from "~/components/crud/FormShell";
import { StatusTag } from "~/components/crud/StatusTag";
import { accessTo } from "~/lib/access";
import { api } from "~/lib/api";
import { describeFailure } from "~/lib/crud/errors";
import { ifMatch } from "~/lib/crud/etag";
import { type FlashControl, flashState, useFlash } from "~/lib/crud/flash";
import type { ItemPayload } from "~/lib/crud/types";
import { useFormValues } from "~/lib/crud/useFormValues";
import { useItem } from "~/lib/crud/useItem";
import { useMutation } from "~/lib/crud/useMutation";
import { usePageTitle } from "~/lib/hooks";
import { useMe } from "~/lib/session";
import { type AdminItem, type AdminValues, API_PATH, AREA_LABEL, AREA_MENUS, AREAS, FIELD_LABELS, ROLE_HINT, ROLE_LABEL, ROLES, ROUTE, STATUS, toCreateBody, toUpdateBody, toValues } from "./model";

// Create and edit an admin, built with the form blocks of docs/cloudflare/admin-crud.md. The same screen serves
// `/settings/new` and `/settings/:id/edit` (the address the Aktivitas page links an admin row to). A port of the
// legacy editor (app/(admin)/admin/settings/_editor-form.tsx) with what the rules changed:
//
//   - a new admin is INVITED by email unless a password is typed (the legacy form saved the password as typed);
//   - an editor has AREAS, ticked here, and saved with the rest in one transaction (`PUT /:id`, If-Match);
//   - there is no password field when editing: a super_admin does not set another person's password, the admin
//     uses "Lupa password" (docs/cloudflare/admin-sistem.md says why);
//   - the last super_admin cannot step down: the Worker answers 409 with the legacy message and the `role` field,
//     and the form shows both.

const ROLE_CARD = "flex cursor-pointer items-start gap-3 rounded-xl border-2 border-gray-200 p-3 transition-colors hover:border-primary-blue has-[:checked]:border-primary-blue has-[:checked]:bg-primary-blue/5";

export function AdminFormPage() {
  const { id } = useParams();
  const me = useMe();
  const canWrite = accessTo(me, "sistem") === "write";
  const item = useItem<AdminItem>(id ? `${API_PATH}/${encodeURIComponent(id)}` : null);
  // Owned here, not by the form: the form is mounted again with every new version, and a notice raised by a save
  // (or one that arrived with the navigation) has to survive that.
  const notice = useFlash();
  usePageTitle(id ? "Edit Admin" : "Admin Baru");

  if (id && (item.status === "loading" || item.status === "idle") && !item.item) {
    return (
      <div className="p-6 md:p-10">
        <p role="status" className="text-sm text-gray-500">
          Memuat admin...
        </p>
      </div>
    );
  }
  if (id && item.status === "error") {
    const missing = item.failure?.status === 404;
    return (
      <div className="max-w-xl space-y-4 p-6 md:p-10">
        <Alert>{missing ? "Admin tidak ditemukan." : item.failure ? describeFailure(item.failure).message : "Gagal memuat admin."}</Alert>
        {missing ? (
          <Button variant="neutral" href={ROUTE}>
            Kembali ke daftar
          </Button>
        ) : (
          <Button variant="neutral" onClick={item.refetch}>
            Coba lagi
          </Button>
        )}
      </div>
    );
  }

  // Keyed by the version: after "Muat ulang" or a save the form starts again from the fresh values.
  return <AdminForm key={item.item?.updatedAt ?? "new"} item={item.item} canWrite={canWrite} notice={notice} onSaved={item.replace} onReload={item.refetch} />;
}

interface FormProps {
  item: AdminItem | null;
  canWrite: boolean;
  notice: FlashControl;
  onSaved: (next: AdminItem) => void;
  onReload: () => void;
}

function AdminForm({ item, canWrite, notice, onSaved, onReload }: FormProps) {
  const form = useFormValues<AdminValues>(toValues(item));
  const navigate = useNavigate();
  const save = useMutation<AdminValues, ItemPayload<AdminItem>>((values) =>
    item
      ? api<ItemPayload<AdminItem>>(`${API_PATH}/${encodeURIComponent(item.id)}`, { method: "PUT", json: toUpdateBody(values), ifMatch: ifMatch(item.updatedAt) })
      : api<ItemPayload<AdminItem>>(API_PATH, { method: "POST", json: toCreateBody(values) }),
  );

  async function submit() {
    notice.dismiss();
    const values = form.values;
    const result = await save.submit(values);
    if (!result) return;
    if (result.ok) {
      if (item) {
        onSaved(result.data.item);
        notice.show({ tone: "success", text: "Perubahan berhasil disimpan." });
      } else {
        const sent = values.password !== "" ? `Email verifikasi dikirim ke ${values.email.trim()}.` : `Undangan dikirim ke ${values.email.trim()}.`;
        navigate(`${ROUTE}/${encodeURIComponent(result.data.item.id)}/edit`, { state: flashState({ tone: "success", text: `Admin berhasil dibuat. ${sent}` }) });
      }
      return;
    }
    // The account exists but the email did not go out (502): the form has done its job. The list shows the new
    // admin as "Diundang" with "Kirim ulang undangan", so that is where the person goes, with the Worker's words.
    if (!item && result.status === 502) {
      // The account was made, so there is nothing left to lose by leaving: the unsaved-changes guard must let this pass.
      save.succeededRef.current = true;
      navigate(ROUTE, { state: flashState({ tone: "danger", text: describeFailure(result).message }) });
    }
  }

  const { fields } = save;
  const role = form.values.role;

  return (
    <FormShell
      title={item ? "Edit Admin" : "Admin Baru"}
      back={{ href: ROUTE }}
      save={save}
      dirty={form.dirty}
      onSubmit={() => void submit()}
      onReload={onReload}
      readOnly={!canWrite}
      saveLabel={item ? "Simpan Perubahan" : "Buat Admin"}
      fieldLabels={FIELD_LABELS}
      meta={item ? <StatusTag map={STATUS} value={item.status} /> : undefined}
      flash={notice}
    >
      <FormSection title="Identitas" description="Email yang dipakai untuk login admin. Bisa dipakai untuk login Google atau email + password.">
        <Field label="Email" id="email" required={!item} error={fields.email} hint={item ? "Email tidak dapat diubah setelah admin dibuat." : "Gunakan email yang aktif untuk login."}>
          <Input type="email" required={!item} readOnly={Boolean(item)} {...form.field("email")} placeholder="nama@contoh.com" autoComplete="off" className={item ? "cursor-not-allowed bg-gray-50" : undefined} />
        </Field>
        <Field label="Nama" id="name" required={Boolean(item)} error={fields.name} hint="Opsional. Muncul sebagai pengirim di log aktivitas.">
          <Input type="text" required={Boolean(item)} {...form.field("name")} placeholder="Contoh: Ahmad Fadillah" autoComplete="off" />
        </Field>
        {!item && (
          <Field
            label="Password"
            id="password"
            error={fields.password}
            hint="Opsional. Kosongkan untuk mengundang lewat email: admin memilih sendiri password-nya lewat tautan di email (berlaku 7 hari). Jika diisi, admin tetap harus membuka email verifikasi dulu sebelum bisa masuk."
          >
            <Input type="password" {...form.field("password")} autoComplete="new-password" placeholder="Password awal (opsional)" />
          </Field>
        )}
      </FormSection>

      <FormSection title="Peran" description="Menentukan apa saja yang bisa diakses oleh admin ini.">
        <Field group label="Peran" required error={fields.role}>
          <div className="space-y-2">
            {ROLES.map((value) => (
              <label key={value} className={ROLE_CARD}>
                <input type="radio" name="role" id={value === ROLES[0] ? "role" : undefined} value={value} required checked={role === value} onChange={() => form.set("role", value)} className="mt-1 accent-primary-blue" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900">{ROLE_LABEL[value]}</span>
                  <span className="mt-0.5 block text-xs text-gray-500">{ROLE_HINT[value]}</span>
                </span>
              </label>
            ))}
          </div>
        </Field>
      </FormSection>

      {role === "editor" && (
        <FormSection title="Area" description="Area yang boleh dilihat dan diubah editor ini. Area yang tidak dicentang tidak terlihat olehnya. Sistem tidak bisa diberikan: hanya untuk Super Admin.">
          <Field group label="Area editor" error={fields.areas} hint={form.values.pendaftaran || form.values.komunikasi || form.values.konten ? undefined : "Belum ada area dipilih: editor hanya akan melihat Dashboard."}>
            <div className="space-y-2">
              {AREAS.map((area, index) => (
                <label key={area} className={ROLE_CARD}>
                  <input type="checkbox" {...form.checkbox(area)} id={index === 0 ? "areas" : area} className="mt-1 accent-primary-blue" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-gray-900">{AREA_LABEL[area]}</span>
                    <span className="mt-0.5 block text-xs text-gray-500">{AREA_MENUS[area]}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
        </FormSection>
      )}
    </FormShell>
  );
}
