import { db } from "@autonoma/db";
import { logger } from "@autonoma/logger";
import { ExternalRunBodySchema } from "@autonoma/types";
import * as Sentry from "@sentry/node";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { verifyApiKeyAndGetContext } from "../application-setup/verify-api-key";
import { ExternalRunsService } from "./external-runs.service";

/**
 * `POST /v1/external-runs/runs` — ingestion endpoint for an EXTERNAL local agent
 * to record a completed test-run RESULT into the platform so it renders in the
 * dashboard.
 *
 * API-key authenticated (Bearer), org-scoped to the key's organization. Mirrors
 * the existing `/v1/setup` router auth/error pattern.
 */
export const externalRunsHttpRouter = new Hono();

externalRunsHttpRouter.use("*", cors({ origin: "*" }));

const service = new ExternalRunsService(db);

externalRunsHttpRouter.post("/runs", async (c) => {
    const apiKeyCtx = await verifyApiKeyAndGetContext(db, c.req.header("authorization"));
    if (apiKeyCtx == null) return c.json({ error: "Unauthorized" }, 401);

    let json: unknown;
    try {
        json = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = ExternalRunBodySchema.safeParse(json);
    if (!parsed.success) {
        return c.json({ error: "Invalid request body", details: parsed.error.flatten() }, 400);
    }

    try {
        const result = await service.ingestRun(apiKeyCtx.organizationId, parsed.data);
        return c.json(result, 201);
    } catch (err) {
        Sentry.captureException(err);
        logger.error("Failed to ingest external run", { err });
        return c.json({ error: "Failed to ingest run" }, 500);
    }
});
