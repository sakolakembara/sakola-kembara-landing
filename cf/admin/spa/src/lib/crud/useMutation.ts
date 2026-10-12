import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import type { ApiResult } from "../api";
import { describeFailure } from "./errors";

// A save (create or update) as a form needs it (docs/cloudflare/admin-crud.md#15-the-spa-kit):
//
//   - a submit LOCK: a second submit while one is in flight is ignored. It is a ref, not the `pending` state:
//     two submits can arrive before React has re-rendered with the disabled button.
//   - the 400 `fields` of the Worker, one message per field, ready for `<Field error={save.fields.title}>`
//   - a `formError` sentence for everything else (403, 429, offline, 5xx, a 409 conflict)
//   - `stale`: the save lost to someone else's (409); the form offers "Muat ulang"
//   - `succeededRef`: true from the moment a save worked, synchronously, so the unsaved-changes guard lets the
//     navigation that follows pass (the re-render that clears `dirty` has not happened yet)

export interface MutationState {
  /** A request is in flight. */
  pending: boolean;
  /** `{ field: message }` of the last failure; empty when it was not about fields. */
  fields: Record<string, string>;
  /** One sentence for the top of the form; null when there is nothing to say. */
  formError: string | null;
  stale: boolean;
  /** Counts failed saves: a form focuses its error summary each time this changes. */
  failures: number;
  succeededRef: MutableRefObject<boolean>;
}

export interface Mutation<TInput, TData> extends MutationState {
  /** Runs the save. Resolves with its result, or null when it was ignored because one is already running. */
  submit(input: TInput): Promise<ApiResult<TData> | null>;
  /** Forgets the last failure (the form was reloaded, or edited again). */
  clearErrors(): void;
}

export function useMutation<TInput, TData = unknown>(action: (input: TInput) => Promise<ApiResult<TData>>): Mutation<TInput, TData> {
  const latest = useRef(action);
  useEffect(() => {
    latest.current = action;
  });

  const locked = useRef(false);
  const succeededRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [failures, setFailures] = useState(0);

  const clearErrors = useCallback(() => {
    setFields({});
    setFormError(null);
    setStale(false);
  }, []);

  const submit = useCallback(
    async (input: TInput) => {
      if (locked.current) return null;
      locked.current = true;
      succeededRef.current = false;
      setPending(true);
      try {
        const result = await latest.current(input);
        if (result.ok) {
          succeededRef.current = true;
          if (mounted.current) clearErrors();
        } else if (mounted.current) {
          const described = describeFailure(result);
          setFields(described.fields);
          setFormError(described.message);
          setStale(described.stale);
          setFailures((count) => count + 1);
        }
        return result;
      } finally {
        locked.current = false;
        if (mounted.current) setPending(false);
      }
    },
    [clearErrors],
  );

  return { pending, fields, formError, stale, failures, succeededRef, submit, clearErrors };
}
