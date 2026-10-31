import { useMemo } from "react";
import { Combobox, type ComboboxOption } from "~/components/ui/combobox";
import { Field, Input } from "~/components/ui/field";
import { useAuthors } from "./useAuthors";

// "Penulis" of the blog form (SAKEM-116): a box to choose from the accounts that can write, not a free text (Dzul: "pakai
// combobox, yang boleh nulis yang udah registered di admin aja"). The article keeps the NAME, as before. An article that
// already has an author the list does not know (the legacy ones were written by names that have no account) keeps it,
// offered as "nama lama" so it can be put back; the Worker accepts an unchanged author and no other free name. If the list
// cannot be loaded the name can be typed, so the form is never blocked by it, and the Worker is still the one that checks.

interface Props {
  /** The field name, the id of the box: the error summary links to it. */
  id: string;
  value: string;
  onChange: (name: string) => void;
  error?: string;
  /** The author the article had when it was opened (empty for a new one). */
  stored: string;
  /** No write access: the name is shown and nothing is asked of the Worker (only a writer may read the list). */
  readOnly?: boolean;
}

export function AuthorField({ readOnly = false, ...props }: Props) {
  if (readOnly) {
    return (
      <Field label="Penulis" id={props.id} required>
        <Input type="text" required name={props.id} value={props.value} readOnly disabled />
      </Field>
    );
  }
  return <ChosenAuthor {...props} />;
}

function ChosenAuthor({ id, value, onChange, error, stored }: Omit<Props, "readOnly">) {
  const { authors, failed } = useAuthors();
  const options = useMemo<ComboboxOption[]>(() => {
    const names = authors ?? [];
    const list: ComboboxOption[] = names.map((name) => ({ value: name, label: name }));
    if (stored !== "" && !names.includes(stored)) list.unshift({ value: stored, label: stored, hint: "nama lama" });
    return list;
  }, [authors, stored]);

  return (
    <Field label="Penulis" id={id} required error={error} hint={failed ? "Daftar penulis belum bisa dimuat. Ketik namanya; yang tidak terdaftar akan ditolak saat disimpan." : "Pilih dari akun yang terdaftar di admin."}>
      {failed ? <Input type="text" required name={id} value={value} onChange={(event) => onChange(event.target.value)} /> : <Combobox name={id} required value={value} options={options} onChange={onChange} emptyText="Tidak ada akun dengan nama itu." />}
    </Field>
  );
}
