import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { type ApiResult, setTransport } from "~/lib/api";
import { useFormValues } from "~/lib/crud/useFormValues";
import { useItem } from "~/lib/crud/useItem";
import { useMutation } from "~/lib/crud/useMutation";
import { deferred, respond, stubApi } from "../helpers";

// useItem, useMutation and useFormValues, each through a small component that shows what it says.

describe("useItem", () => {
  function Probe({ path }: { path: string | null }) {
    const item = useItem<{ id: string; name: string }>(path);
    return (
      <div>
        <p data-testid="state">{`${item.status}|${item.item?.name ?? "-"}|${item.failure?.status ?? "-"}`}</p>
        <button onClick={item.refetch}>refetch</button>
        <button onClick={() => item.replace({ id: "1", name: "Dari Simpan" })}>replace</button>
      </div>
    );
  }
  const state = () => screen.getByTestId("state").textContent;

  test("null is a new one: idle, nothing is requested", () => {
    const api = stubApi({});
    render(<Probe path={null} />);
    expect(state()).toBe("idle|-|-");
    expect(api.calls).toEqual([]);
  });

  test("loads { item } and says loading until it has", async () => {
    const gate = deferred<Response>();
    stubApi({ "GET /api/things/1": () => gate.promise });
    render(<Probe path="/api/things/1" />);
    expect(state()).toBe("loading|-|-");
    gate.resolve(respond({ item: { id: "1", name: "Satu" } }));
    await waitFor(() => expect(state()).toBe("ready|Satu|-"));
  });

  test("a failure keeps its status (a 404 is how a gone item is told apart), and refetch asks again", async () => {
    let missing = true;
    const api = stubApi({ "GET /api/things/1": () => Promise.resolve(missing ? respond({ error: "not_found" }, 404) : respond({ item: { id: "1", name: "Ada Lagi" } })) });
    render(<Probe path="/api/things/1" />);
    await waitFor(() => expect(state()).toBe("error|-|404"));
    missing = false;
    fireEvent.click(screen.getByText("refetch"));
    await waitFor(() => expect(state()).toBe("ready|Ada Lagi|-"));
    expect(api.count("GET /api/things/1")).toBe(2);
  });

  test("replace puts in what a save answered, with no second request", async () => {
    const api = stubApi({ "GET /api/things/1": respond({ item: { id: "1", name: "Satu" } }) });
    render(<Probe path="/api/things/1" />);
    await waitFor(() => expect(state()).toContain("Satu"));
    fireEvent.click(screen.getByText("replace"));
    expect(state()).toBe("ready|Dari Simpan|-");
    expect(api.count("GET /api/things/1")).toBe(1);
  });

  test("a new path aborts the old request; unmounting aborts it too", async () => {
    const signals: AbortSignal[] = [];
    setTransport(async (_path, init) => {
      if (init.signal) signals.push(init.signal);
      return new Promise<Response>(() => undefined);
    });
    const view = render(<Probe path="/api/things/1" />);
    await waitFor(() => expect(signals).toHaveLength(1));
    view.rerender(<Probe path="/api/things/2" />);
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    view.unmount();
    expect(signals[1]!.aborted).toBe(true);
  });
});

describe("useMutation", () => {
  type Saved = { item: { id: string } };

  function Probe({ run }: { run: (input: string) => Promise<ApiResult<Saved>> }) {
    const save = useMutation<string, Saved>(run);
    return (
      <div>
        <button onClick={() => void save.submit("isi")}>save</button>
        <p data-testid="state">{`${save.pending ? "pending" : "idle"}|stale ${save.stale}|failures ${save.failures}|succeeded ${save.succeededRef.current}`}</p>
        <p data-testid="error">{save.formError ?? ""}</p>
        <p data-testid="fields">{JSON.stringify(save.fields)}</p>
        <button onClick={save.clearErrors}>clear</button>
      </div>
    );
  }
  const state = () => screen.getByTestId("state").textContent;
  const ok = (): ApiResult<Saved> => ({ ok: true, data: { item: { id: "1" } } });

  test("a second submit while one is in flight is ignored, however fast (the lock is a ref, not the state)", async () => {
    const gate = deferred<ApiResult<Saved>>();
    let calls = 0;
    render(
      <Probe
        run={() => {
          calls += 1;
          return gate.promise;
        }}
      />,
    );
    const button = screen.getByText("save");
    // Three clicks in the same tick, before React can re-render a disabled button.
    act(() => {
      button.click();
      button.click();
      button.click();
    });
    expect(calls).toBe(1);
    expect(state()).toContain("pending");

    await act(async () => gate.resolve(ok()));
    expect(state()).toContain("idle");
    fireEvent.click(button);
    expect(calls).toBe(2); // free again
  });

  test("the 400 `fields` of the Worker are there for the Fields, with the sentence for the top", async () => {
    render(<Probe run={async () => ({ ok: false, status: 400, code: "invalid", message: "Periksa kembali isian formulir.", fields: { title: "Judul minimal 3 karakter" } })} />);
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(screen.getByTestId("fields").textContent).toBe('{"title":"Judul minimal 3 karakter"}'));
    expect(screen.getByTestId("error").textContent).toBe("Periksa kembali isian formulir.");
    expect(state()).toContain("failures 1");
  });

  test("a stale save is flagged, with the sentence that says what happens to the form", async () => {
    render(<Probe run={async () => ({ ok: false, status: 409, code: "stale" })} />);
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(state()).toContain("stale true"));
    expect(screen.getByTestId("error").textContent).toContain("Perubahan yang belum disimpan akan hilang");
  });

  test("everything else is a plain sentence, never a raw code", async () => {
    for (const [failure, expected] of [
      [{ ok: false, status: 0 }, "Tidak dapat terhubung ke server"],
      [{ ok: false, status: 403, code: "forbidden" }, "Kamu tidak punya izin"],
      [{ ok: false, status: 429, code: "rate_limited", retryAfter: 60 }, "Coba lagi dalam 1 menit"],
      [{ ok: false, status: 500, code: "internal" }, "Terjadi kesalahan di server"],
    ] as const) {
      const view = render(<Probe run={async () => failure} />);
      fireEvent.click(view.getByText("save"));
      await waitFor(() => expect(view.getByTestId("error").textContent).toContain(expected));
      view.unmount();
    }
  });

  test("a success clears the errors and sets the flag at once, so the guard lets the navigation after it pass", async () => {
    let fail = true;
    render(<Probe run={async () => (fail ? { ok: false, status: 400, code: "invalid", fields: { title: "salah" } } : ok())} />);
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(screen.getByTestId("fields").textContent).toContain("salah"));
    expect(state()).toContain("succeeded false");

    fail = false;
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(screen.getByTestId("fields").textContent).toBe("{}"));
    expect(screen.getByTestId("error").textContent).toBe("");
    expect(state()).toContain("succeeded true");
  });

  test("clearErrors forgets the last failure", async () => {
    render(<Probe run={async () => ({ ok: false, status: 409, code: "stale" })} />);
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(state()).toContain("stale true"));
    fireEvent.click(screen.getByText("clear"));
    expect(state()).toContain("stale false");
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  test("it uses the latest `run`, not the one of the first render", async () => {
    const seen: string[] = [];
    const view = render(<Probe run={async (input) => (seen.push(`old:${input}`), ok())} />);
    view.rerender(<Probe run={async (input) => (seen.push(`new:${input}`), ok())} />);
    fireEvent.click(screen.getByText("save"));
    await waitFor(() => expect(seen).toEqual(["new:isi"]));
  });

  test("an answer that arrives after the page is gone does not touch the screen (no warning, no error)", async () => {
    const gate = deferred<ApiResult<Saved>>();
    const view = render(<Probe run={() => gate.promise} />);
    fireEvent.click(screen.getByText("save"));
    view.unmount();
    await act(async () => gate.resolve({ ok: false, status: 500, code: "internal" }));
    // setup.ts fails the test on any console.error: reaching here is the assertion.
    expect(true).toBe(true);
  });
});

describe("useFormValues", () => {
  function Probe() {
    const form = useFormValues<{ title: string; active: boolean; kind: string }>({ title: "Awal", active: false, kind: "a" });
    return (
      <div>
        <input aria-label="Judul" {...form.field("title")} />
        <input type="checkbox" aria-label="Aktif" {...form.checkbox("active")} />
        <select aria-label="Jenis" {...form.field("kind")}>
          <option value="a">A</option>
          <option value="b">B</option>
        </select>
        <p data-testid="dirty">{String(form.dirty)}</p>
        <p data-testid="values">{JSON.stringify(form.values)}</p>
        <button onClick={() => form.reset()}>reset</button>
        <button onClick={() => form.reset({ title: "Baru", active: true, kind: "b" })}>reload</button>
      </div>
    );
  }
  const dirty = () => screen.getByTestId("dirty").textContent;

  test("starts clean; typing makes it dirty and typing the old value back makes it clean again", () => {
    render(<Probe />);
    expect(dirty()).toBe("false");
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Ubah" } });
    expect(dirty()).toBe("true");
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Awal" } });
    expect(dirty()).toBe("false");
  });

  test("checkbox and select bind by name, and the control's id is the field name (the error summary links to it)", () => {
    render(<Probe />);
    expect(screen.getByLabelText("Judul").id).toBe("title");
    expect(screen.getByLabelText("Judul").getAttribute("name")).toBe("title");
    fireEvent.click(screen.getByLabelText("Aktif"));
    fireEvent.change(screen.getByLabelText("Jenis"), { target: { value: "b" } });
    expect(JSON.parse(screen.getByTestId("values").textContent!)).toEqual({ title: "Awal", active: true, kind: "b" });
    expect(dirty()).toBe("true");
  });

  test("reset() goes back to the start; reset(next) makes the new values the saved ones", () => {
    render(<Probe />);
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Ubah" } });
    fireEvent.click(screen.getByText("reset"));
    expect((screen.getByLabelText("Judul") as HTMLInputElement).value).toBe("Awal");
    expect(dirty()).toBe("false");

    fireEvent.click(screen.getByText("reload"));
    expect((screen.getByLabelText("Judul") as HTMLInputElement).value).toBe("Baru");
    expect(dirty()).toBe("false"); // the loaded values are what "unchanged" means now
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Awal" } });
    expect(dirty()).toBe("true");
  });
});
