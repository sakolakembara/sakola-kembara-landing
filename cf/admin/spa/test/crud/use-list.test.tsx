import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { api as request, setTransport } from "~/lib/api";
import { cachedRead } from "~/lib/crud/readCache";
import type { ListSpec } from "~/lib/crud/query";
import { useList } from "~/lib/crud/useList";
import { deferred, renderAt, respond, stubApi } from "../helpers";

const spec: ListSpec = { filters: ["kind"], sorts: ["name"], defaultSort: "name" };

interface Row {
  id: string;
  name: string;
}

function payload(names: string[], extra: { page?: number; total?: number } = {}) {
  return { items: names.map((name, index) => ({ id: `id-${index}-${name}`, name })), page: extra.page ?? 1, pageSize: 20, total: extra.total ?? names.length };
}

/** A screen that shows what `useList` says, with buttons for what it can do. */
function Probe() {
  const list = useList<Row>("/api/things", spec);
  return (
    <div>
      <p data-testid="state">{`${list.status}|${list.refreshing ? "refreshing" : "idle"}|page ${list.page}/${list.totalPages}|total ${list.total}`}</p>
      <p data-testid="query">{JSON.stringify(list.query)}</p>
      <p data-testid="failure">{list.failure ? `${list.failure.status}` : ""}</p>
      <ul>
        {list.items.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
      <button onClick={() => list.apply({ q: "cari", filters: { kind: "a" } })}>apply</button>
      <button onClick={() => list.setSort("-name")}>sort</button>
      <button onClick={() => list.setPage(3)}>page3</button>
      <button onClick={() => list.reset()}>reset</button>
      <button onClick={list.refetch}>refetch</button>
      <p data-testid="next">{list.searchFor(2)}</p>
    </div>
  );
}

const state = () => screen.getByTestId("state").textContent;
const location = () => screen.getByTestId("location").textContent;

describe("useList", () => {
  test("loads with the query of the address bar, and says so while it does", async () => {
    const gate = deferred<Response>();
    const api = stubApi({ "GET /api/things": () => gate.promise });
    renderAt(<Probe />, "/things?page=2&kind=b&q=halo&sort=-name");

    expect(state()).toBe("loading|idle|page 2/1|total 0");
    expect(api.last("GET /api/things")?.url).toBe("/api/things?page=2&pageSize=20&q=halo&kind=b&sort=-name");

    gate.resolve(respond(payload(["Satu", "Dua"], { page: 2, total: 45 })));
    await screen.findByText("Satu");
    expect(state()).toBe("ready|idle|page 2/3|total 45");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Satu", "Dua"]);
  });

  test("an address bar with nothing special asks for the defaults", async () => {
    const api = stubApi({ "GET /api/things": respond(payload([])) });
    renderAt(<Probe />, "/things");
    await waitFor(() => expect(state()).toContain("ready"));
    expect(api.last("GET /api/things")?.url).toBe("/api/things?page=1&pageSize=20&sort=name");
  });

  test("applying a search and filters goes back to page 1 and writes the address bar (the defaults left out)", async () => {
    const api = stubApi({ "GET /api/things": respond(payload(["Satu"], { total: 1 })) });
    renderAt(<Probe />, "/things?page=4&sort=-name");
    await screen.findByText("Satu");

    fireEvent.click(screen.getByText("apply"));
    await waitFor(() => expect(location()).toBe("/things?q=cari&kind=a&sort=-name"));
    expect(api.last("GET /api/things")?.url).toBe("/api/things?page=1&pageSize=20&q=cari&kind=a&sort=-name");
  });

  test("sorting and paging write the address bar; reset clears the search and the filters but keeps the sort", async () => {
    stubApi({ "GET /api/things": respond(payload(["Satu"], { total: 100 })) });
    renderAt(<Probe />, "/things?q=halo&kind=a");
    await screen.findByText("Satu");

    fireEvent.click(screen.getByText("sort"));
    await waitFor(() => expect(location()).toBe("/things?q=halo&kind=a&sort=-name"));
    fireEvent.click(screen.getByText("page3"));
    await waitFor(() => expect(location()).toBe("/things?q=halo&kind=a&sort=-name&page=3"));
    fireEvent.click(screen.getByText("reset"));
    await waitFor(() => expect(location()).toBe("/things?sort=-name"));
  });

  test("searchFor gives the query of another page, for links", async () => {
    stubApi({ "GET /api/things": respond(payload(["Satu"], { total: 100 })) });
    renderAt(<Probe />, "/things?kind=b");
    await screen.findByText("Satu");
    expect(screen.getByTestId("next").textContent).toBe("?kind=b&page=2");
  });

  test("a new query aborts the request in flight, and only the last answer is used", async () => {
    const first = deferred<Response>();
    const signals: AbortSignal[] = [];
    let calls = 0;
    setTransport(async (_path, init) => {
      calls += 1;
      if (init.signal) signals.push(init.signal);
      return calls === 1 ? first.promise : respond(payload(["Dari Pencarian"], { total: 1 }));
    });
    renderAt(<Probe />, "/things");
    await waitFor(() => expect(calls).toBe(1));

    fireEvent.click(screen.getByText("apply")); // a second query while the first is slow
    await screen.findByText("Dari Pencarian");
    expect(signals[0]!.aborted).toBe(true);

    // The slow first answer arrives late and is ignored.
    await act(async () => {
      first.resolve(respond(payload(["Jawaban Lama"], { total: 1 })));
    });
    expect(screen.queryByText("Jawaban Lama")).toBeNull();
    expect(screen.getByText("Dari Pencarian")).toBeTruthy();
  });

  test("leaving the page aborts the request", async () => {
    let signal: AbortSignal | null | undefined;
    const never = new Promise<Response>(() => undefined);
    setTransport(async (_path, init) => {
      signal = init.signal;
      return never;
    });
    const view = renderAt(<Probe />, "/things");
    await waitFor(() => expect(signal).toBeTruthy());
    expect(signal!.aborted).toBe(false);
    view.unmount();
    expect(signal!.aborted).toBe(true);
  });

  test("while another page loads the rows of the one before stay (refreshing)", async () => {
    const gate = deferred<Response>();
    let calls = 0;
    stubApi({ "GET /api/things": () => (++calls === 1 ? Promise.resolve(respond(payload(["Halaman Satu"], { total: 100 }))) : gate.promise) });
    renderAt(<Probe />, "/things");
    await screen.findByText("Halaman Satu");

    fireEvent.click(screen.getByText("page3"));
    await waitFor(() => expect(state()).toContain("refreshing"));
    expect(screen.getByText("Halaman Satu")).toBeTruthy(); // still there, not an empty table
    gate.resolve(respond(payload(["Halaman Tiga"], { page: 3, total: 100 })));
    await screen.findByText("Halaman Tiga");
    expect(state()).toContain("idle");
  });

  test("the rows stay and the list is refreshing also when only a filter changes (same page), and when it is asked again", async () => {
    const gate = deferred<Response>();
    let calls = 0;
    stubApi({ "GET /api/things": () => (++calls === 1 ? Promise.resolve(respond(payload(["Semua"], { total: 1 }))) : gate.promise) });
    renderAt(<Probe />, "/things");
    await screen.findByText("Semua");
    expect(state()).toBe("ready|idle|page 1/1|total 1");

    fireEvent.click(screen.getByText("apply")); // page 1 stays page 1
    await waitFor(() => expect(state()).toContain("refreshing"));
    expect(screen.getByText("Semua")).toBeTruthy();
    gate.resolve(respond(payload(["Terfilter"], { total: 1 })));
    await screen.findByText("Terfilter");
    expect(state()).toBe("ready|idle|page 1/1|total 1");
  });

  test("a failure is an error state with its status, and refetch asks again", async () => {
    let fail = true;
    const api = stubApi({ "GET /api/things": () => Promise.resolve(fail ? respond({ error: "internal" }, 500) : respond(payload(["Pulih"]))) });
    renderAt(<Probe />, "/things");
    await waitFor(() => expect(state()).toContain("error"));
    expect(screen.getByTestId("failure").textContent).toBe("500");

    fail = false;
    fireEvent.click(screen.getByText("refetch"));
    await screen.findByText("Pulih");
    expect(api.count("GET /api/things")).toBe(2);
    expect(screen.getByTestId("failure").textContent).toBe("");
  });

  test("a page past the end (the last row of the last page was deleted) moves to the last page that exists", async () => {
    const api = stubApi({
      "GET /api/things": (call) => {
        const page = Number(new URL(call.url, "http://x.invalid").searchParams.get("page"));
        return Promise.resolve(respond(page > 2 ? { items: [], page, pageSize: 20, total: 40 } : payload(["Di Halaman Dua"], { page, total: 40 })));
      },
    });
    renderAt(<Probe />, "/things?page=5");
    await screen.findByText("Di Halaman Dua");
    expect(location()).toBe("/things?page=2");
    expect(api.count("GET /api/things")).toBe(2);
  });

  test("an empty list with nothing in it stays on its page", async () => {
    const api = stubApi({ "GET /api/things": respond({ items: [], page: 1, pageSize: 20, total: 0 }) });
    renderAt(<Probe />, "/things?page=3");
    await waitFor(() => expect(state()).toContain("ready"));
    // total 0: there is no last page to move to, so no loop of requests.
    expect(api.count("GET /api/things")).toBe(1);
    expect(location()).toBe("/things?page=3");
  });
});

describe("useList: what the screen showed last (lib/crud/readCache.ts)", () => {
  test("a list opened before shows its last answer at once and is asked for again in the background", async () => {
    stubApi({ "GET /api/things": respond(payload(["Satu"])) });
    const first = renderAt(<Probe />, "/things");
    await screen.findByText("Satu");
    first.unmount();

    const gate = deferred<Response>();
    const api = stubApi({ "GET /api/things": () => gate.promise });
    renderAt(<Probe />, "/things");
    expect(screen.getByText("Satu")).toBeTruthy();
    expect(state()).toBe("ready|refreshing|page 1/1|total 1");
    expect(api.count("GET /api/things")).toBe(1);

    gate.resolve(respond(payload(["Dua"])));
    await screen.findByText("Dua");
    expect(screen.queryByText("Satu")).toBeNull();
    expect(state()).toBe("ready|idle|page 1/1|total 1");
  });

  test("the first render of a list opened before already has its rows: no flash of the loading row", async () => {
    stubApi({ "GET /api/things": respond(payload(["Satu"])) });
    const first = renderAt(<Probe />, "/things");
    await screen.findByText("Satu");
    first.unmount();

    const seen: string[] = [];
    function Spy() {
      seen.push(useList<Row>("/api/things", spec).status);
      return null;
    }
    stubApi({ "GET /api/things": () => deferred<Response>().promise });
    renderAt(<Spy />, "/things");
    expect(seen[0]).toBe("ready");
  });

  test("going back to a query asked before shows its answer at once, not the rows of the query just left", async () => {
    let held: ReturnType<typeof deferred<Response>> | null = null;
    stubApi({
      "GET /api/things": (call) => {
        if (call.url.includes("q=cari")) return Promise.resolve(respond(payload(["Dua"])));
        return held ? held.promise : Promise.resolve(respond(payload(["Satu"])));
      },
    });
    renderAt(<Probe />, "/things");
    await screen.findByText("Satu");
    fireEvent.click(screen.getByText("apply"));
    await screen.findByText("Dua");

    held = deferred<Response>();
    fireEvent.click(screen.getByText("reset"));
    expect(screen.getByText("Satu")).toBeTruthy();
    expect(screen.queryByText("Dua")).toBeNull();
    expect(state()).toBe("ready|refreshing|page 1/1|total 1");
    held.resolve(respond(payload(["Satu", "Tiga"])));
    await screen.findByText("Tiga");
  });

  test("another query of the same list has its own answer", async () => {
    stubApi({ "GET /api/things": respond(payload(["Satu"])) });
    const first = renderAt(<Probe />, "/things");
    await screen.findByText("Satu");
    first.unmount();

    const gate = deferred<Response>();
    stubApi({ "GET /api/things": () => gate.promise });
    renderAt(<Probe />, "/things?q=lain");
    expect(screen.queryByText("Satu")).toBeNull();
    expect(state()).toBe("loading|idle|page 1/1|total 0");
    gate.resolve(respond(payload([])));
    await waitFor(() => expect(state()).toContain("ready"));
  });

  test("a write empties it: a list is not shown with what has just been changed", async () => {
    stubApi({ "GET /api/things": respond(payload(["Satu"])), "DELETE /api/things/1": respond(null, 204) });
    const first = renderAt(<Probe />, "/things");
    await screen.findByText("Satu");
    first.unmount();
    await request("/api/things/1", { method: "DELETE" });

    const gate = deferred<Response>();
    stubApi({ "GET /api/things": () => gate.promise });
    renderAt(<Probe />, "/things");
    expect(screen.queryByText("Satu")).toBeNull();
    expect(state()).toBe("loading|idle|page 1/1|total 0");
    gate.resolve(respond(payload(["Dua"])));
    await screen.findByText("Dua");
  });

  test("an answer that was on its way when a write happened is not kept", async () => {
    const gate = deferred<Response>();
    stubApi({ "GET /api/things": () => gate.promise, "POST /api/things": respond({}, 201) });
    renderAt(<Probe />, "/things");
    await request("/api/things", { method: "POST", json: {} });
    gate.resolve(respond(payload(["Vieux"])));
    await screen.findByText("Vieux");
    expect(cachedRead("/api/things?page=1&pageSize=20&sort=name")).toBeUndefined();
  });

  test("a failure is not kept", async () => {
    stubApi({ "GET /api/things": respond({ error: "boom" }, 500) });
    renderAt(<Probe />, "/things");
    await waitFor(() => expect(state()).toContain("error"));
    expect(cachedRead("/api/things?page=1&pageSize=20&sort=name")).toBeUndefined();
  });
});
