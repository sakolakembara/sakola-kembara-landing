import { Plus, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Field, Input, Select, Textarea } from "~/components/ui/field";
import { FormCard, FormColumns, FormShell } from "~/components/crud/FormShell";
import { PageTabs } from "~/components/crud/PageTabs";
import { UploadField } from "~/components/crud/UploadField";
import { accessTo } from "~/lib/access";
import { api } from "~/lib/api";
import { ifMatch } from "~/lib/crud/etag";
import { type FlashControl, flashState, useFlash } from "~/lib/crud/flash";
import type { ItemPayload } from "~/lib/crud/types";
import { useFormTabs } from "~/lib/crud/useFormTabs";
import { useFormValues } from "~/lib/crud/useFormValues";
import { useItem } from "~/lib/crud/useItem";
import { useMutation } from "~/lib/crud/useMutation";
import { usePageTitle } from "~/lib/hooks";
import { useMe } from "~/lib/session";
import { ForbiddenPage } from "../Forbidden";
import { itemGate } from "../konten/itemGate";
import {
  API_PATH,
  blankEducation,
  blankWork,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  cleanEducation,
  cleanWork,
  type EducationRow,
  educationRows,
  fieldLabels,
  MAX_HISTORY,
  ROUTE,
  type TeamItem,
  type TeamTab,
  type TeamValues,
  tabOf,
  toBody,
  toValues,
  type WorkRow,
  workRows,
} from "./model";

// Create and edit a team member, built with the form blocks of docs/cloudflare/admin-crud.md. The same screen serves
// `/team/new` and `/team/:id/edit`. What the legacy admin did, kept: the identity (name, role, category, display
// order), the photo, the bio, and two lists of entries (education, work) whose blank rows disappear on save
// ("Kosongkan institusi untuk menghapus baris saat disimpan."). A new member opens its edit page with "Anggota
// berhasil dibuat."; saving an existing one stays on the page with "Anggota tim berhasil disimpan.".

export function TeamFormPage() {
  const { id } = useParams();
  const me = useMe();
  const canWrite = accessTo(me, "konten") === "write";
  const item = useItem<TeamItem>(id ? `${API_PATH}/${encodeURIComponent(id)}` : null);
  // Owned here, not by the form: the form is mounted again with every new version (see the announcements screen).
  const notice = useFlash();
  // A save that changed nothing keeps its version, but the form still has to start again from what was saved
  // (the blank rows it dropped), so the form is keyed by this as well.
  const [saves, setSaves] = useState(0);
  usePageTitle(id ? "Edit Anggota" : "Anggota Baru");

  const gate = itemGate(id, item, { noun: "anggota", listHref: ROUTE });
  if (gate) return gate;
  if (!id && !canWrite) return <ForbiddenPage />;

  return (
    <TeamForm
      key={`${item.item?.updatedAt ?? "new"}:${saves}`}
      item={item.item}
      canWrite={canWrite}
      notice={notice}
      onSaved={(next) => {
        item.replace(next);
        setSaves((count) => count + 1);
      }}
      onReload={item.refetch}
    />
  );
}

interface FormProps {
  item: TeamItem | null;
  canWrite: boolean;
  notice: FlashControl;
  onSaved: (next: TeamItem) => void;
  onReload: () => void;
}

interface Keyed<T> {
  key: string;
  value: T;
}

let rowKeyCounter = 0;
const nextKey = () => `row-${++rowKeyCounter}`;
const keyed = <T,>(value: T): Keyed<T> => ({ key: nextKey(), value });

/** The rows to start from: the member's entries, or one empty row to type into (legacy). */
const initialRows = <T,>(rows: T[], blank: () => T): Keyed<T>[] => (rows.length > 0 ? rows : [blank()]).map(keyed);

/**
 * Where each row ends up in what is sent: a row with nothing in its required box is dropped, so the Worker's field
 * names ("educationHistory.1.institution") count the rows that were KEPT. This gives each row the name its errors
 * will have, which is also the `id` of its boxes (so the error summary can link to them).
 */
function positions<T>(rows: readonly Keyed<T>[], kept: (value: T) => boolean): (number | null)[] {
  let next = 0;
  return rows.map((row) => (kept(row.value) ? next++ : null));
}

function TeamForm({ item, canWrite, notice, onSaved, onReload }: FormProps) {
  const form = useFormValues<TeamValues>(toValues(item));
  const navigate = useNavigate();
  const [education, setEducation] = useState(() => initialRows(educationRows(item?.educationHistory ?? []), blankEducation));
  const [work, setWork] = useState(() => initialRows(workRows(item?.workHistory ?? []), blankWork));

  // What the rows were when the form opened, in the shape they are sent, to know whether they changed.
  const baseline = useRef(JSON.stringify([cleanEducation(educationRows(item?.educationHistory ?? [])), cleanWork(workRows(item?.workHistory ?? []))]));
  const historiesChanged = JSON.stringify([cleanEducation(education.map((row) => row.value)), cleanWork(work.map((row) => row.value))]) !== baseline.current;

  const save = useMutation<TeamValues, ItemPayload<TeamItem>>((values) => {
    const body = toBody(
      values,
      education.map((row) => row.value),
      work.map((row) => row.value),
    );
    return item
      ? api<ItemPayload<TeamItem>>(`${API_PATH}/${encodeURIComponent(item.id)}`, { method: "PUT", json: body, ifMatch: ifMatch(item.updatedAt) })
      : api<ItemPayload<TeamItem>>(API_PATH, { method: "POST", json: body });
  });

  async function submit() {
    notice.dismiss();
    const result = await save.submit(form.values);
    if (!result?.ok) return;
    if (item) {
      onSaved(result.data.item);
      notice.show({ tone: "success", text: "Anggota tim berhasil disimpan." });
    } else {
      navigate(`${ROUTE}/${encodeURIComponent(result.data.item.id)}/edit`, { state: flashState({ tone: "success", text: "Anggota berhasil dibuat." }) });
    }
  }

  const { fields } = save;
  const labels = useMemo(fieldLabels, []);
  const educationAt = positions(education, (value) => value.institution.trim() !== "");
  const workAt = positions(work, (value) => value.organization.trim() !== "");

  function patchEducation(key: string, patch: Partial<EducationRow>) {
    setEducation((rows) => rows.map((row) => (row.key === key ? { ...row, value: { ...row.value, ...patch } } : row)));
  }
  function patchWork(key: string, patch: Partial<WorkRow>) {
    setWork((rows) => rows.map((row) => (row.key === key ? { ...row, value: { ...row.value, ...patch } } : row)));
  }

  const { tab, setTab, errorTabs } = useFormTabs<TeamTab>({ initial: "profil", tabOf, fields, failures: save.failures });
  // Someone who cannot write has nothing to switch between, and a disabled fieldset would disable the tab buttons (they sit
  // inside it): they get both parts on one page.
  const tabbed = canWrite;
  const showProfil = !tabbed || tab === "profil";
  const showRiwayat = !tabbed || tab === "riwayat";

  return (
    <FormShell
      title={item ? "Edit Anggota" : "Anggota Baru"}
      back={{ href: ROUTE }}
      save={save}
      dirty={form.dirty || historiesChanged}
      onSubmit={() => void submit()}
      onReload={onReload}
      readOnly={!canWrite}
      saveLabel={item ? "Simpan Perubahan" : "Buat Anggota"}
      fieldLabels={labels}
      flash={notice}
      page={{
        crumb: item ? item.name : "Anggota baru",
        tabs: tabbed ? (
          <PageTabs
            label="Bagian formulir"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "profil", label: "Profil", invalid: errorTabs.has("profil") },
              { id: "riwayat", label: "Riwayat", invalid: errorTabs.has("riwayat") },
            ]}
          />
        ) : undefined,
      }}
    >
      <div className={tabbed ? undefined : "space-y-8"}>
        <div role="tabpanel" id="panel-profil" aria-labelledby={tabbed ? "tab-profil" : undefined} aria-label={tabbed ? undefined : "Profil"} hidden={!showProfil}>
          <FormColumns
            aside={
              <FormCard title="Foto" description="Foto kotak 1:1 paling rapi (akan ditampilkan sebagai lingkaran di publik). Maksimal 5 MB.">
                <UploadField id="image" label="Foto anggota" kind="team-photo" value={form.values.image || null} onChange={(path) => form.set("image", path ?? "")} error={fields.image} disabled={!canWrite} />
              </FormCard>
            }
          >
            <FormCard title="Identitas" description="Informasi dasar yang muncul di halaman /tim publik.">
              {/* Not `required` for the browser: with Riwayat open, an empty required box on the hidden Profil tab would make it refuse the save without a word. The Worker refuses it and the page opens Profil. */}
              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Nama Lengkap" id="name" required error={fields.name}>
                  <Input type="text" aria-required="true" {...form.field("name")} placeholder="Contoh: Ahmad Fadillah" />
                </Field>
                <Field label="Peran" id="role" required error={fields.role}>
                  <Input type="text" aria-required="true" {...form.field("role")} placeholder="Contoh: Ketua Umum" />
                </Field>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Kategori" id="category" required error={fields.category} hint="Menentukan section di /tim tempat kartu ini tampil.">
                  <Select aria-required="true" {...form.field("category")}>
                    {CATEGORY_ORDER.map((category) => (
                      <option key={category} value={category}>
                        {CATEGORY_LABEL[category]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Urutan Tampil" id="displayOrder" required error={fields.displayOrder} hint="Lebih kecil = lebih dulu (dalam kategori yang sama). Kelipatan 10 dianjurkan.">
                  <Input type="number" aria-required="true" min={0} max={9999} {...form.field("displayOrder")} />
                </Field>
              </div>
            </FormCard>

            <FormCard title="Bio" description="Deskripsi panjang yang muncul di drawer profil publik.">
              <Field label="Bio" id="bio" error={fields.bio}>
                <Textarea rows={5} {...form.field("bio")} placeholder="Latar belakang singkat, fokus kerja, dan minat pribadi." className="min-h-[120px] resize-y" />
              </Field>
            </FormCard>
          </FormColumns>
        </div>

        <div role="tabpanel" id="panel-riwayat" aria-labelledby={tabbed ? "tab-riwayat" : undefined} aria-label={tabbed ? undefined : "Riwayat"} hidden={!showRiwayat}>
          <FormColumns>
            <FormCard title="Riwayat Pendidikan" description="Kosongkan institusi untuk menghapus baris saat disimpan.">
              <div id="educationHistory" tabIndex={-1} className="space-y-3 outline-none">
                {fields.educationHistory && <p className="text-xs text-danger-fg">{fields.educationHistory}</p>}
                {education.map((row, index) => {
                  const at = educationAt[index];
                  const name = (field: string) => (at === null || at === undefined ? `educationHistory-extra-${row.key}.${field}` : `educationHistory.${at}.${field}`);
                  const errors = at === null || at === undefined ? [] : (["institution", "degree", "year"] as const).map((field) => fields[`educationHistory.${at}.${field}`]).filter(Boolean);
                  return (
                    <div key={row.key} className="rounded-lg border border-gray-200 p-3">
                      <div className="grid items-start gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto]">
                        <Input type="text" size="sm" id={name("institution")} aria-label={`Institusi pendidikan ${index + 1}`} value={row.value.institution} onChange={(event) => patchEducation(row.key, { institution: event.target.value })} placeholder="Institusi (mis. Universitas Indonesia)" />
                        <Input type="text" size="sm" id={name("degree")} aria-label={`Gelar atau jurusan pendidikan ${index + 1}`} value={row.value.degree} onChange={(event) => patchEducation(row.key, { degree: event.target.value })} placeholder="Gelar / jurusan (mis. S1 Pendidikan)" />
                        <Input type="text" size="sm" id={name("year")} aria-label={`Tahun pendidikan ${index + 1}`} value={row.value.year} onChange={(event) => patchEducation(row.key, { year: event.target.value })} placeholder="Tahun (mis. 2018)" />
                        <button type="button" onClick={() => setEducation((rows) => rows.filter((candidate) => candidate.key !== row.key))} className="p-2 text-gray-400 transition-colors hover:text-red-600" aria-label={`Hapus baris pendidikan ${index + 1}`}>
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                      {errors.map((message) => (
                        <p key={message} className="mt-1.5 text-xs text-danger-fg">
                          {message}
                        </p>
                      ))}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setEducation((rows) => [...rows, keyed(blankEducation())])}
                  disabled={education.length >= MAX_HISTORY}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-primary-blue transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus size={14} aria-hidden="true" /> Tambah Pendidikan
                </button>
              </div>
            </FormCard>

            <FormCard title="Riwayat Pekerjaan" description="Kosongkan organisasi untuk menghapus baris saat disimpan.">
              <div id="workHistory" tabIndex={-1} className="space-y-3 outline-none">
                {fields.workHistory && <p className="text-xs text-danger-fg">{fields.workHistory}</p>}
                {work.map((row, index) => {
                  const at = workAt[index];
                  const name = (field: string) => (at === null || at === undefined ? `workHistory-extra-${row.key}.${field}` : `workHistory.${at}.${field}`);
                  const errors = at === null || at === undefined ? [] : (["organization", "role", "period"] as const).map((field) => fields[`workHistory.${at}.${field}`]).filter(Boolean);
                  return (
                    <div key={row.key} className="rounded-lg border border-gray-200 p-3">
                      <div className="grid items-start gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto]">
                        <Input type="text" size="sm" id={name("organization")} aria-label={`Organisasi pekerjaan ${index + 1}`} value={row.value.organization} onChange={(event) => patchWork(row.key, { organization: event.target.value })} placeholder="Organisasi (mis. Kemendikbud)" />
                        <Input type="text" size="sm" id={name("role")} aria-label={`Peran pekerjaan ${index + 1}`} value={row.value.role} onChange={(event) => patchWork(row.key, { role: event.target.value })} placeholder="Peran (mis. Analis Program)" />
                        <Input type="text" size="sm" id={name("period")} aria-label={`Periode pekerjaan ${index + 1}`} value={row.value.period} onChange={(event) => patchWork(row.key, { period: event.target.value })} placeholder="Periode (mis. 2019–2022)" />
                        <button type="button" onClick={() => setWork((rows) => rows.filter((candidate) => candidate.key !== row.key))} className="p-2 text-gray-400 transition-colors hover:text-red-600" aria-label={`Hapus baris pekerjaan ${index + 1}`}>
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                      {errors.map((message) => (
                        <p key={message} className="mt-1.5 text-xs text-danger-fg">
                          {message}
                        </p>
                      ))}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setWork((rows) => [...rows, keyed(blankWork())])}
                  disabled={work.length >= MAX_HISTORY}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-primary-blue transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus size={14} aria-hidden="true" /> Tambah Pekerjaan
                </button>
              </div>
            </FormCard>
          </FormColumns>
        </div>
      </div>
    </FormShell>
  );
}
