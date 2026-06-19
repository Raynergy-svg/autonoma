#!/usr/bin/env node
/**
 * Autonoma agent-runtime runner (Paperclip-style).
 *
 * Orchestrates a LOCAL agent instance (Claude Code or Codex — your own
 * subscription auth, no API keys) to execute an Autonoma test case by driving a
 * real browser via the Playwright MCP. This is the "Claude/Codex creates the
 * agents" path: the platform produces the test case; a local agent executes it.
 *
 * Usage:
 *   node scripts/agent-runtime/run.mjs <test-case.md> [baseUrl] [--runtime claude-code|codex] [--check]
 *
 *   --check   only run testEnvironment() for each adapter and exit.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeCode } from "./adapters/claude-code.mjs";
import { codex } from "./adapters/codex.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADAPTERS = { "claude-code": claudeCode, codex };

// Playwright MCP tools the agent is allowed to use (server is named "playwright").
const PLAYWRIGHT_TOOLS = [
    "browser_navigate",
    "browser_snapshot",
    "browser_click",
    "browser_type",
    "browser_fill_form",
    "browser_press_key",
    "browser_take_screenshot",
    "browser_console_messages",
    "browser_wait_for",
].map((t) => `mcp__playwright__${t}`);

function parseFrontmatter(raw) {
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) return { data: {}, body: raw };
    const data = {};
    for (const line of m[1].split("\n")) {
        const i = line.indexOf(":");
        if (i === -1) continue;
        data[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
    return { data, body: m[2].trim() };
}

function buildPrompt({ name, baseUrl, body }) {
    return [
        `You are an autonomous E2E test execution agent. Execute this test case against a running web app by driving the browser with the Playwright MCP tools (navigate, snapshot, click, type, etc.). Use accessibility snapshots to find elements.`,
        ``,
        `BASE URL: ${baseUrl}`,
        `TEST CASE: ${name}`,
        ``,
        `--- TEST ---`,
        body,
        `--- END TEST ---`,
        ``,
        `Execute every step in order. Then output ONLY a final JSON object on its own line, no prose after it:`,
        `{"status":"pass"|"fail","steps":[{"n":1,"action":"...","status":"pass"|"fail","observed":"..."}],"notes":"..."}`,
    ].join("\n");
}

async function main() {
    const args = process.argv.slice(2);
    const flags = new Set(args.filter((a) => a.startsWith("--")));
    const positional = args.filter((a) => !a.startsWith("--"));
    const runtimeIdx = args.indexOf("--runtime");
    const runtimeId = runtimeIdx !== -1 ? args[runtimeIdx + 1] : "claude-code";

    if (flags.has("--check")) {
        for (const [id, adapter] of Object.entries(ADAPTERS)) {
            const env = await adapter.testEnvironment();
            console.log(`${id.padEnd(12)} ${env.ok ? "✓" : "✗"} ${env.version ?? "(not available)"}`);
        }
        return;
    }

    const [testCaseArg, baseUrlArg] = positional;
    if (!testCaseArg) {
        console.error("Usage: node run.mjs <test-case.md> [baseUrl] [--runtime claude-code|codex] [--check]");
        process.exit(1);
    }
    const adapter = ADAPTERS[runtimeId];
    if (!adapter) {
        console.error(`Unknown runtime '${runtimeId}'. Options: ${Object.keys(ADAPTERS).join(", ")}`);
        process.exit(1);
    }
    const testCasePath = path.resolve(testCaseArg);
    if (!existsSync(testCasePath)) {
        console.error(`No such test case: ${testCasePath}`);
        process.exit(1);
    }

    const { data, body } = parseFrontmatter(readFileSync(testCasePath, "utf8"));
    const name = path.basename(testCasePath, path.extname(testCasePath));
    const baseUrl = baseUrlArg ?? data.baseUrl ?? data.url ?? "";

    const env = await adapter.testEnvironment();
    if (!env.ok) {
        console.error(`Runtime '${runtimeId}' not available. Is it installed + logged in?`);
        process.exit(1);
    }

    console.log(`▶ ${adapter.label} executing '${name}' against ${baseUrl || "(no baseUrl)"} …`);
    const prompt = buildPrompt({ name, baseUrl, body });

    const result = await adapter.execute({
        prompt,
        cwd: HERE,
        mcpConfigPath: runtimeId === "claude-code" ? path.join(HERE, "playwright-mcp.json") : undefined,
        allowedTools: runtimeId === "claude-code" ? PLAYWRIGHT_TOOLS : undefined,
    });

    // Pull the trailing JSON result block out of the agent's output.
    let verdict = null;
    const match = result.text.match(/\{[\s\S]*"status"[\s\S]*\}\s*$/);
    if (match) {
        try {
            verdict = JSON.parse(match[0]);
        } catch {
            /* leave null */
        }
    }

    const outPath = path.join(HERE, ".result.json");
    writeFileSync(
        outPath,
        JSON.stringify({ name, runtime: runtimeId, baseUrl, ok: result.ok, verdict, costUsd: result.costUsd, agentText: result.text }, null, 2),
    );
    console.log(`\nruntime ok: ${result.ok}   cost: ${result.costUsd != null ? `$${result.costUsd.toFixed(4)}` : "n/a"}`);
    console.log(`verdict: ${verdict ? verdict.status : "(no JSON verdict parsed)"}`);
    console.log(`result → ${path.relative(process.cwd(), outPath)}`);
}

main().catch((e) => {
    console.error("agent-runtime error:", e.message);
    process.exit(1);
});
