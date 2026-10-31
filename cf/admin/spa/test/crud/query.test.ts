import { describe, expect, test } from "vitest";
import { cleanSearch, isFiltered, type ListSpec, pageNumbers, pageSizeChoices, parseListQuery, toApiQuery, toSearchParams, totalPages } from "~/lib/crud/query";

const spec: ListSpec = { filters: ["severity", "active"], sorts: ["createdAt", "title"], defaultSort: "-createdAt" };
const parse = (search: string) => parseListQuery(new URLSearchParams(search), spec);

describe("parseListQuery: the address bar is the state", () => {
  test("an empty address bar is the defaults", () => {
    expect(parse("")).toEqual({ page: 1, pageSize: 20, q: "", sort: "-createdAt", filters: {} });
  });

  test("a good one is read as it is", () => {
    expect(parse("page=3&q=halo&severity=info&sort=title")).toEqual({ page: 3, pageSize: 20, q: "halo", sort: "title", filters: { severity: "info" } });
    expect(parse("sort=-title")).toMatchObject({ sort: "-title" });
  });

  test("page: anything but a positive integer is 1, a huge one is capped", () => {
    for (const page of ["0", "-1", "abc", "1.5", "", "1e3"]) expect(parse(`page=${page}`).page, page).toBe(1);
    expect(parse("page=99999999").page).toBe(10_000);
  });

  test("a sort that is not in the spec is the default; names of other filters are ignored; spaces are trimmed", () => {
    expect(parse("sort=password").sort).toBe("-createdAt");
    expect(parse("sort=-password").sort).toBe("-createdAt");
    expect(parse("unknown=1&other=2").filters).toEqual({});
    expect(parse("severity=%20info%20&active=").filters).toEqual({ severity: "info" });
    expect(parse(`q=${"x".repeat(200)}`).q).toHaveLength(48);
  });

  test("pageSize: a size on offer is read; any other number is the screen's own", () => {
    expect(parse("pageSize=50").pageSize).toBe(50);
    expect(parse("pageSize=100").pageSize).toBe(100);
    for (const size of ["0", "-5", "abc", "7", "1000", "20.5", ""]) expect(parse(`pageSize=${size}`).pageSize, size).toBe(20);
    // A screen's own size (the lists of a few dozen rows ask for 100; Pengaturan for 50) is a size on offer and the default.
    expect(parseListQuery(new URLSearchParams("pageSize=10"), { pageSize: 100 }).pageSize).toBe(10);
    expect(parseListQuery(new URLSearchParams(""), { pageSize: 100 }).pageSize).toBe(100);
    expect(pageSizeChoices({ pageSize: 30 })).toEqual([10, 20, 30, 50, 100]);
    expect(pageSizeChoices({ pageSize: 50 })).toEqual([10, 20, 50, 100]);
  });

  test("a spec without sorts has no sort at all", () => {
    expect(parseListQuery(new URLSearchParams("sort=title"), {}).sort).toBe("");
  });
});

describe("toSearchParams: the defaults are left out", () => {
  test("nothing special is an empty query", () => {
    expect(toSearchParams(parse(""), spec).toString()).toBe("");
  });

  test("what differs is written, and reads back to the same query", () => {
    const query = parse("page=2&q=halo&severity=urgent&active=true&sort=-title");
    const text = toSearchParams(query, spec).toString();
    expect(text).toBe("q=halo&severity=urgent&active=true&sort=-title&page=2");
    expect(parse(text)).toEqual(query);
  });

  test("the default sort and page 1 are not written", () => {
    expect(toSearchParams({ page: 1, pageSize: 20, q: "", sort: "-createdAt", filters: {} }, spec).toString()).toBe("");
    expect(toSearchParams({ page: 1, pageSize: 20, q: "", sort: "title", filters: {} }, spec).toString()).toBe("sort=title");
  });

  test("a page size other than the screen's own is written (and read back); its own is not", () => {
    expect(toSearchParams(parse("pageSize=50&page=2"), spec).toString()).toBe("pageSize=50&page=2");
    expect(parse(toSearchParams(parse("pageSize=50"), spec).toString()).pageSize).toBe(50);
    expect(toSearchParams(parse("pageSize=20"), spec).toString()).toBe("");
    expect(toSearchParams(parseListQuery(new URLSearchParams("pageSize=100"), { pageSize: 100 }), { pageSize: 100 }).toString()).toBe("");
  });
});

describe("toApiQuery: the request says everything it means", () => {
  test("page and pageSize are always sent, with the sort and the filters", () => {
    expect(toApiQuery(parse(""), spec)).toBe("?page=1&pageSize=20&sort=-createdAt");
    expect(toApiQuery(parse("page=2&q=halo%20dunia&severity=info"), spec)).toBe("?page=2&pageSize=20&q=halo+dunia&severity=info&sort=-createdAt");
    expect(toApiQuery(parseListQuery(new URLSearchParams(), { ...spec, pageSize: 50 }), { ...spec, pageSize: 50 })).toContain("pageSize=50");
    expect(toApiQuery(parse("pageSize=100"), spec)).toBe("?page=1&pageSize=100&sort=-createdAt");
  });

  test("a value that looks like a query string cannot add a parameter", () => {
    const query = { page: 1, pageSize: 20, q: "a&sort=-createdBy", sort: "-createdAt", filters: { severity: "x&page=9" } };
    const params = new URLSearchParams(toApiQuery(query, spec));
    expect(params.get("q")).toBe("a&sort=-createdBy");
    expect(params.get("severity")).toBe("x&page=9");
    expect(params.get("sort")).toBe("-createdAt");
    expect(params.get("page")).toBe("1");
  });
});

describe("pages", () => {
  test("totalPages is at least 1", () => {
    expect(totalPages(0, 20)).toBe(1);
    expect(totalPages(20, 20)).toBe(1);
    expect(totalPages(21, 20)).toBe(2);
    expect(totalPages(87, 20)).toBe(5);
    expect(totalPages(5, 0)).toBe(5); // a bad page size does not divide by zero
  });

  test("pageNumbers: all up to seven, then the ends and the neighbours with gaps", () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageNumbers(1, 20)).toEqual([1, 2, "…", 20]);
    expect(pageNumbers(10, 20)).toEqual([1, "…", 9, 10, 11, "…", 20]);
    expect(pageNumbers(20, 20)).toEqual([1, "…", 19, 20]);
    expect(pageNumbers(3, 20)).toEqual([1, 2, 3, 4, "…", 20]);
  });

  test("isFiltered: a search or a filter narrows the list, a sort or a page does not", () => {
    expect(isFiltered(parse("page=3&sort=title"))).toBe(false);
    expect(isFiltered(parse("q=halo"))).toBe(true);
    expect(isFiltered(parse("severity=info"))).toBe(true);
  });

  test("cleanSearch trims and cuts", () => {
    expect(cleanSearch("  halo  ")).toBe("halo");
    expect(cleanSearch("y".repeat(100))).toHaveLength(48);
  });
});
