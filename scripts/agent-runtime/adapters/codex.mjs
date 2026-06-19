/**
 * Codex CLI runtime adapter (Paperclip-style).
 *
 * Runs a LOCAL Codex instance via `codex exec` (non-interactive), using the
 * machine's existing Codex login — no API key. Same adapter shape as claude-code.
 * Codex's exec output is plain text (not JSON), so we capture stdout directly.
 */
import { spawn } from "node:child_process";

export const codex = {
    id: "codex",
    label: "Codex CLI (local)",

    async testEnvironment() {
        return await new Promise((resolve) => {
            const p = spawn("codex", ["--version"]);
            let out = "";
            p.stdout.on("data", (d) => (out += d));
            p.on("error", () => resolve({ ok: false, version: null }));
            p.on("close", (code) => resolve({ ok: code === 0, version: out.trim() || null }));
        });
    },

    /**
     * @param {{prompt:string, cwd?:string}} task
     * @returns {Promise<{ok:boolean, text:string, costUsd:null, sessionId:null, raw:{stdout:string,exit:number}}>}
     */
    async execute({ prompt, cwd = process.cwd() }) {
        // `codex exec` runs a single non-interactive turn and prints the result.
        const args = ["exec", "--skip-git-repo-check", prompt];
        return await new Promise((resolve, reject) => {
            const p = spawn("codex", args, { cwd });
            let stdout = "";
            let stderr = "";
            p.stdout.on("data", (d) => (stdout += d));
            p.stderr.on("data", (d) => (stderr += d));
            p.on("error", reject);
            p.on("close", (code) => {
                resolve({
                    ok: code === 0,
                    text: (stdout || stderr).trim(),
                    costUsd: null,
                    sessionId: null,
                    raw: { stdout, exit: code ?? -1 },
                });
            });
        });
    },
};
