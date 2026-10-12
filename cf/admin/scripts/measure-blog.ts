// Wall-clock and CPU time of the blog renderer, in Node (the Worker's CPU cannot be measured locally: workerd
// freezes its timers during synchronous code, see docs/cloudflare/admin-crud.md#13-cpu-rules). These numbers are
// a hint, not a Worker measurement; SAKEM-084 measures on a Free account against the 10 ms limit.
//
//   pnpm measure:blog
//
// Reports: the time to load the module (what a cold isolate pays once), the first render, then the 80 migrated
// articles warm (median, p95, max, and the longest article), and synthetic articles of 20k, 40k and 80k
// characters (the legacy limit) built from real paragraphs.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const here = path.dirname(fileURLToPath(import.meta.url));
const contentDir = path.resolve(here, "../../../content/blog");

const cpuMs = (before: NodeJS.CpuUsage) => {
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000;
};

const loadStart = process.cpuUsage();
const loadWall = performance.now();
const { renderArticle } = await import("../src/blog/render");
const loadCpu = cpuMs(loadStart);
console.log(`module load: ${loadCpu.toFixed(1)} ms cpu, ${(performance.now() - loadWall).toFixed(1)} ms wall`);

const articles = readdirSync(contentDir)
  .filter((file) => file.endsWith(".md") && file !== "README.md")
  .map((file) => {
    const { content } = matter(readFileSync(path.join(contentDir, file), "utf8"));
    return { file, markdown: content.trim() };
  });

function time(markdown: string): { cpu: number; wall: number } {
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();
  renderArticle(markdown);
  return { cpu: cpuMs(cpuStart), wall: performance.now() - wallStart };
}

const first = time(articles[0]!.markdown);
console.log(`first render (cold JIT): ${first.cpu.toFixed(1)} ms cpu, ${first.wall.toFixed(1)} ms wall (${articles[0]!.markdown.length} chars)`);

const quantile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))]!;
const rounds = 5;
const samples: { file: string; length: number; cpu: number[]; wall: number[] }[] = articles.map((a) => ({ file: a.file, length: a.markdown.length, cpu: [], wall: [] }));
for (let round = 0; round < rounds; round++) {
  articles.forEach((article, index) => {
    const t = time(article.markdown);
    samples[index]!.cpu.push(t.cpu);
    samples[index]!.wall.push(t.wall);
  });
}
const warm = (pick: (s: (typeof samples)[number]) => number[]) => samples.flatMap((s) => pick(s).slice(1)); // drop each article's first pass
const warmCpu = warm((s) => s.cpu);
const warmWall = warm((s) => s.wall);
console.log(`80 articles, warm: cpu median ${quantile(warmCpu, 0.5).toFixed(2)} p95 ${quantile(warmCpu, 0.95).toFixed(2)} max ${Math.max(...warmCpu).toFixed(2)} ms; wall median ${quantile(warmWall, 0.5).toFixed(2)} p95 ${quantile(warmWall, 0.95).toFixed(2)} max ${Math.max(...warmWall).toFixed(2)} ms`);
const longest = [...samples].sort((a, b) => b.length - a.length)[0]!;
console.log(`longest article (${longest.length} chars, ${longest.file}): cpu median ${quantile(longest.cpu.slice(1), 0.5).toFixed(2)} ms, wall median ${quantile(longest.wall.slice(1), 0.5).toFixed(2)} ms`);

// Synthetic: real paragraphs repeated up to the size.
const paragraphs = articles.flatMap((a) => a.markdown.split(/\n{2,}/)).filter((p) => p.length > 80);
function synthetic(chars: number): string {
  const out: string[] = [];
  let length = 0;
  for (let i = 0; length < chars; i++) {
    const paragraph = paragraphs[i % paragraphs.length]!;
    out.push(paragraph);
    length += paragraph.length + 2;
  }
  return out.join("\n\n").slice(0, chars);
}
for (const chars of [8_000, 12_000, 20_000, 40_000, 80_000]) {
  const markdown = synthetic(chars);
  time(markdown); // warm this size once
  const cpu: number[] = [];
  const wall: number[] = [];
  for (let i = 0; i < 15; i++) {
    const t = time(markdown);
    cpu.push(t.cpu);
    wall.push(t.wall);
  }
  console.log(`synthetic ${String(chars).padStart(6)} chars: cpu median ${quantile(cpu, 0.5).toFixed(2)} max ${Math.max(...cpu).toFixed(2)} ms; wall median ${quantile(wall, 0.5).toFixed(2)} max ${Math.max(...wall).toFixed(2)} ms`);
}
