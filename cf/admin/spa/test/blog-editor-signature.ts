// What a reader gets from an article, with what Markdown says in more than one way taken out: the words, in order, with
// the marks each run of words carries (bold, italic, strike, code, link and where it goes), the blocks around them
// (headings, paragraphs, lists, quotes, code, tables, rules) and the pictures. Used to say that the editor did not lose
// anything: two renderings of the Worker with the same signature read the same.
//
// Not part of the signature, on purpose: bold and italic nested the other way round, a link inside bold or bold inside a
// link, a space left at the end of a heading, an empty link, and a list whose items are paragraphs ("loose") against one
// whose items are plain text ("tight"). Markdown writes each of those in two ways and the editor writes one of them.

const MARKS: Record<string, string> = { STRONG: "strong", B: "strong", EM: "em", I: "em", DEL: "del", S: "del", CODE: "code" };
const BLOCKS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "HR", "DIV"]);

type Token = { kind: "open" | "close" | "word" | "image"; value: string; marks?: string };

function collect(node: Node, marks: string[], out: Token[]) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.push({ kind: "word", value: child.textContent ?? "", marks: [...new Set(marks)].sort().join("+") });
      continue;
    }
    if (!(child instanceof Element)) continue;
    const tag = child.tagName;
    if (tag === "IMG") out.push({ kind: "image", value: `${child.getAttribute("src")} | ${child.getAttribute("alt") ?? ""}` });
    else if (tag === "BR") out.push({ kind: "word", value: "\n", marks: "" });
    else if (MARKS[tag]) collect(child, [...marks, MARKS[tag]], out);
    else if (tag === "A") collect(child, [...marks, `a(${child.getAttribute("href") ?? ""})`], out);
    else if (BLOCKS.has(tag)) {
      // A list item that is one paragraph is the same as a plain one.
      const only = tag === "LI" && child.children.length > 0 && Array.from(child.children).every((each) => each.tagName === "P") && child.children.length === 1;
      if (tag === "DIV") collect(child, marks, out);
      else {
        out.push({ kind: "open", value: tag.toLowerCase() });
        collect(only ? child.children[0]! : child, marks, out);
        out.push({ kind: "close", value: tag.toLowerCase() });
      }
    } else collect(child, marks, out); // span wrappers and the like
  }
}

export function signature(html: string): string[] {
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
  const tokens: Token[] = [];
  collect(body, [], tokens);
  // Words with the same marks that follow each other are one run; whitespace is one space; the ends of a block are trimmed.
  const result: string[] = [];
  let run: { text: string; marks: string } | null = null;
  const flush = () => {
    if (run && run.text.replace(/\s+/g, " ").trim() !== "") result.push(`${run.marks}:${run.text.replace(/\s+/g, " ")}`);
    run = null;
  };
  for (const token of tokens) {
    if (token.kind === "word") {
      if (run && run.marks === token.marks) run.text += token.value;
      else {
        flush();
        run = { text: token.value, marks: token.marks ?? "" };
      }
    } else {
      flush();
      result.push(token.kind === "image" ? `img ${token.value}` : `<${token.kind === "close" ? "/" : ""}${token.value}>`);
    }
  }
  flush();
  // Spaces at the edges of a run are the neighbour's business: trim them, and drop runs that were only a space.
  return result.map((entry) => entry.replace(/^([^:]*):\s+/, "$1:").replace(/\s+$/, ""));
}
