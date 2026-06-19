/**
 * Claude Code runtime adapter (Paperclip-style).
 *
 * Runs a LOCAL headless Claude Code instance as an execution agent, using the
 * machine's existing Claude login (Max/Pro subscription) — no API key. Mirrors
 * Paperclip's per-runtime adapter shape: { id, testEnvironment, execute }.
 */
import { spawn } from "node:child_process";

export const claudeCode = {
    id: "claude-code",
    label: "Claude Code (local, subscription auth)",

    /** Is the runtime installed + usable? */
    async testEnvironment() {
        return await new Promise((resolve) => {
            const p = spawn("claude", ["--version"]);
            let out = "";
            p.stdout.on("data", (d) => (out += d));
            p.on("error", () => resolve({ ok: false, version: null }));
            p.on("close", (code) => resolve({ ok: code === 0, version: out.trim() || null }));
        });
    },

    /**
     * Run one task to completion.
     * @param {{prompt:string, cwd?:string, mcpConfigPath?:string, model?:string, allowedTools?:string[]}} task
     * @returns {Promise<{ok:boolean, text:string, costUsd:number|null, sessionId:string|null, raw:object}>}
     */
    async execute({ prompt, cwd = process.cwd(), mcpConfigPath, model, allowedTools }) {
        const args = ["-p", prompt, "--output-format", "json", "--permission-mode", "acceptEdits"];
        if (mcpConfigPath != null) args.push("--mcp-config", mcpConfigPath, "--strict-mcp-config");
        if (model != null) args.push("--model", model);
        if (allowedTools != null && allowedTools.length > 0) args.push("--allowed-tools", allowedTools.join(","));

        return await new Promise((resolve, reject) => {
            const p = spawn("claude", args, { cwd });
            let stdout = "";
            let stderr = "";
            p.stdout.on("data", (d) => (stdout += d));
            p.stderr.on("data", (d) => (stderr += d));
            p.on("error", reject);
            p.on("close", (code) => {
                let json;
                try {
                    json = JSON.parse(stdout);
                } catch {
                    reject(
                        new Error(
                            `claude-code returned non-JSON (exit ${code}): ${(stderr || stdout).slice(0, 400)}`,
                        ),
                    );
                    return;
                }
                resolve({
                    ok: json.is_error !== true && code === 0,
                    text: typeof json.result === "string" ? json.result : "",
                    costUsd: typeof json.total_cost_usd === "number" ? json.total_cost_usd : null,
                    sessionId: json.session_id ?? null,
                    raw: json,
                });
            });
        });
    },
};
