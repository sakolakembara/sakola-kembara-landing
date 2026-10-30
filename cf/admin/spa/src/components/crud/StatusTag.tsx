import { Tag, type TagTone } from "~/components/ui/tag";

/**
 * A status as a pill (docs/cloudflare/admin-crud.md#15-the-spa-kit): one map per resource from the value the API
 * sends to its label and tone, written once next to the screen:
 *
 *   const SEVERITY = makeStatusMap({ info: { label: "Info", tone: "blue" }, warning: { label: "Peringatan", tone: "amber" } });
 *   <StatusTag map={SEVERITY} value={row.severity} />
 *
 * A value the map does not know (a status the API grew before this screen did) is a gray pill with the raw
 * value, never a crash and never an empty cell.
 */
export type StatusMap<K extends string = string> = Record<K, { label: string; tone: TagTone }>;

export function makeStatusMap<K extends string>(map: StatusMap<K>): StatusMap<K> {
  return map;
}

export function StatusTag({ map, value, size = "sm" }: { map: StatusMap; value: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  const text = value ?? "";
  // `hasOwn`: a value such as "constructor" is not a status.
  const entry = Object.hasOwn(map, text) ? map[text] : undefined;
  return (
    <Tag tone={entry?.tone ?? "gray"} size={size}>
      {entry?.label ?? (text === "" ? "-" : text)}
    </Tag>
  );
}
