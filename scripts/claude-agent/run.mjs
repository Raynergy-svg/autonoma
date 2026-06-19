#!/usr/bin/env node
/**
 * Claude-driven execution agent for Autonoma test cases.
 *
 * This is an alternative to apps/engine-web's pixel-vision agent: instead of the
 * platform's Gemini point-detection + Playwright-command loop, it hands the test
 * case to Claude Code, which drives the browser via the Playwright MCP using
 * accessibility snapshots (the proven "/autonoma execution-agent" pattern).
 *
 * It consumes the SAME input the platform's LocalRunner does — a markdown test
 * case with gray-matter frontmatter (params incl. a base URL) + a natural-language
 * prompt body — and (walking up the tree) the same autonoma/skills/ context.
 *
 * Usage:
 *   node scripts/claude-agent/run.mjs <test-case.md> [baseUrl]
 *
 * It writes a Claude-executable task to scripts/claude-agent/.task.json and a
 * result template to scripts/claude-agent/.result.json. Claude reads the task,
 * drives Playwright, then fills in the result.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Minimal gray-matter: split a leading `---` frontmatter block from the body. */
function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (val === "true") val = true;
    else if (val === "false") val = false;
    data[key] = val;
  }
  return { data, body: m[2].trim() };
}

/** Walk up from the test file to find autonoma/skills/ and load skill names+descriptions. */
function loadSkills(filePath) {
  let dir = path.dirname(path.resolve(filePath));
  while (dir !== path.parse(dir).root) {
    const skillsDir = path.join(dir, "autonoma", "skills");
    if (existsSync(skillsDir)) {
      const skills = [];
      for (const f of readdirSync(skillsDir)) {
        if (!f.endsWith(".md")) continue;
        const { data } = parseFrontmatter(readFileSync(path.join(skillsDir, f), "utf8"));
        skills.push({ name: data.name ?? f.slice(0, -3), description: data.description ?? "" });
      }
      if (skills.length) return skills;
    }
    dir = path.dirname(dir);
  }
  return [];
}

const [testCaseArg, baseUrlArg] = process.argv.slice(2);
if (!testCaseArg) {
  console.error("Usage: node scripts/claude-agent/run.mjs <test-case.md> [baseUrl]");
  process.exit(1);
}
const testCasePath = path.resolve(testCaseArg);
if (!existsSync(testCasePath)) {
  console.error(`No such test case: ${testCasePath}`);
  process.exit(1);
}

const { data, body } = parseFrontmatter(readFileSync(testCasePath, "utf8"));
const name = path.basename(testCasePath, path.extname(testCasePath));
const baseUrl = baseUrlArg ?? data.baseUrl ?? data.url ?? data.target ?? "";
const skills = loadSkills(testCasePath);

const task = {
  name,
  title: data.title ?? name,
  criticality: data.criticality ?? "unknown",
  baseUrl,
  prompt: body,
  skills,
  resultFile: path.join(HERE, ".result.json"),
};

writeFileSync(path.join(HERE, ".task.json"), JSON.stringify(task, null, 2));
writeFileSync(
  path.join(HERE, ".result.json"),
  JSON.stringify(
    { name, status: "pending", steps: [], notes: "", screenshots: [], startedAt: null, finishedAt: null },
    null,
    2,
  ),
);

console.log(`Claude execution task: ${name}`);
console.log(`  baseUrl   : ${baseUrl || "(none in frontmatter — pass one as arg)"}`);
console.log(`  title     : ${task.title}   criticality: ${task.criticality}`);
console.log(`  skills    : ${skills.map((s) => s.name).join(", ") || "(none)"}`);
console.log(`  task file : ${path.relative(process.cwd(), task.resultFile).replace(".result", ".task")}`);
console.log(`  result    : ${path.relative(process.cwd(), task.resultFile)}`);
console.log(`\n--- TEST PROMPT ---\n${body}\n--- END PROMPT ---`);
console.log(`\nClaude: navigate to baseUrl, execute the prompt via the Playwright MCP,`);
console.log(`screenshot key states, then write per-step pass/fail to ${path.relative(process.cwd(), task.resultFile)}.`);
