import type { Prisma, PrismaClient } from "@autonoma/db";
import type { ExternalRunBody, ExternalRunStep } from "@autonoma/types";
import { toSlug } from "@autonoma/utils";
import { Service } from "../routes/service";

/**
 * Default application that external (non-github) run results are attributed to,
 * so they never collide with real github-backed applications. Created lazily,
 * scoped to the caller's organization.
 */
const DEFAULT_EXTERNAL_APP_NAME = "External Runs";
const DEFAULT_FOLDER_NAME = "External";
const DEFAULT_BRANCH_NAME = "external";

export interface IngestExternalRunResult {
    runId: string;
    testCaseId: string;
    applicationId: string;
    status: "success" | "failed";
}

/**
 * Ingests a completed test-run RESULT reported by an external local agent.
 *
 * The platform normally only ever writes Run rows from inside the Temporal
 * workers (via the replay engine). This service is the minimal viable path for
 * an EXTERNAL agent to push a result in over HTTP: it find-or-creates the whole
 * supporting chain a Run needs to render in the dashboard
 *
 *   Application → Branch → BranchSnapshot → Folder → TestCase
 *              → StepInputList (+ StepInput[]) → TestCaseAssignment
 *              → Run (+ StepOutputList (+ StepOutput[]))
 *
 * everything is scoped to `organizationId`, and the actual writes happen in a
 * single transaction so a partial chain is never left behind on failure.
 */
export class ExternalRunsService extends Service {
    constructor(private readonly db: PrismaClient) {
        super();
    }

    async ingestRun(organizationId: string, body: ExternalRunBody): Promise<IngestExternalRunResult> {
        const runStatus: "success" | "failed" = body.status === "pass" ? "success" : "failed";

        // Normalize steps: always persist at least one step so the run detail
        // view has something to render and the list view shows a step count.
        const steps: ExternalRunStep[] =
            body.steps.length > 0
                ? body.steps
                : [
                      {
                          interaction: "navigate",
                          params: body.baseUrl != null ? { url: body.baseUrl } : {},
                          output: { outcome: runStatus === "success" ? "passed" : "failed" },
                      },
                  ];

        const now = new Date();
        const completedAt = now;
        const startedAt =
            body.runtimeMs != null ? new Date(now.getTime() - body.runtimeMs) : now;

        // Fold caller-supplied context (notes + cost) into the run's reasoning so
        // it surfaces in the detail view without needing extra tables/columns.
        const reasoningParts: string[] = [];
        if (body.notes != null && body.notes.trim() !== "") reasoningParts.push(body.notes.trim());
        if (body.baseUrl != null) reasoningParts.push(`Base URL: ${body.baseUrl}`);
        if (body.costUsd != null) reasoningParts.push(`Cost: $${body.costUsd.toFixed(4)}`);
        reasoningParts.push("Source: external agent (claude-agent)");
        const reasoning = reasoningParts.join("\n");

        const applicationName = body.applicationName ?? DEFAULT_EXTERNAL_APP_NAME;

        this.logger.info("Ingesting external run", {
            organizationId,
            testCaseName: body.testCaseName,
            applicationName,
            status: runStatus,
            stepCount: steps.length,
        });

        return this.db.$transaction(async (tx) => {
            const application = await this.findOrCreateApplication(tx, organizationId, applicationName);
            const snapshotId = await this.findOrCreateActiveSnapshot(tx, organizationId, application.id);
            const folderId = await this.findOrCreateFolder(tx, organizationId, application.id);

            const testCaseSlug = toSlug(body.testCaseName);
            const testCase = await tx.testCase.upsert({
                where: { applicationId_slug: { applicationId: application.id, slug: testCaseSlug } },
                update: {},
                create: {
                    name: body.testCaseName,
                    slug: testCaseSlug,
                    applicationId: application.id,
                    folderId,
                    organizationId,
                },
                select: { id: true },
            });

            // A plan is required to own the StepInputList (planId is NOT NULL on it).
            const plan = await tx.testPlan.create({
                data: {
                    testCaseId: testCase.id,
                    prompt: body.testCaseName,
                    organizationId,
                },
                select: { id: true },
            });

            // StepInputList + StepInputs describe the executed steps; StepOutputs
            // reference these by id (the run detail view joins through them). Rows
            // are created top-level (FKs as scalars) to match how the workers
            // write them, rather than via deeply-nested relation creates.
            const stepInputList = await tx.stepInputList.create({
                data: { planId: plan.id, organizationId },
                select: { id: true },
            });
            const stepInputByOrder = new Map<number, string>();
            for (const [index, step] of steps.entries()) {
                const stepInput = await tx.stepInput.create({
                    data: {
                        listId: stepInputList.id,
                        order: index,
                        interaction: step.interaction,
                        params: (step.params ?? {}) as object,
                        organizationId,
                    },
                    select: { id: true },
                });
                stepInputByOrder.set(index, stepInput.id);
            }

            // The assignment ties the test case + snapshot + steps together; the
            // Run requires it (assignmentId is NOT NULL). Upsert so re-runs of the
            // same test in this snapshot reuse the assignment, repointing its steps.
            const assignment = await tx.testCaseAssignment.upsert({
                where: { snapshotId_testCaseId: { snapshotId, testCaseId: testCase.id } },
                update: { stepsId: stepInputList.id, planId: plan.id },
                create: {
                    snapshotId,
                    testCaseId: testCase.id,
                    stepsId: stepInputList.id,
                    planId: plan.id,
                },
                select: { id: true },
            });

            const run = await tx.run.create({
                data: {
                    assignmentId: assignment.id,
                    organizationId,
                    planId: plan.id,
                    status: runStatus,
                    startedAt,
                    completedAt,
                    reasoning,
                },
                select: { id: true },
            });

            const stepOutputList = await tx.stepOutputList.create({
                data: { runId: run.id, organizationId },
                select: { id: true },
            });
            for (const [index, step] of steps.entries()) {
                await tx.stepOutput.create({
                    data: {
                        listId: stepOutputList.id,
                        order: index,
                        organizationId,
                        stepInputId: stepInputByOrder.get(index)!,
                        output: (step.output ?? {
                            outcome: runStatus === "success" ? "passed" : "failed",
                        }) as object,
                        screenshotBefore: step.screenshotBefore ?? null,
                        screenshotAfter: step.screenshotAfter ?? null,
                    },
                });
            }

            this.logger.info("External run ingested", { runId: run.id, testCaseId: testCase.id });

            return {
                runId: run.id,
                testCaseId: testCase.id,
                applicationId: application.id,
                status: runStatus,
            };
        });
    }

    private async findOrCreateApplication(
        tx: Prisma.TransactionClient,
        organizationId: string,
        name: string,
    ): Promise<{ id: string }> {
        const existing = await tx.application.findUnique({
            where: { name_organizationId: { name, organizationId } },
            select: { id: true },
        });
        if (existing != null) return existing;

        return tx.application.create({
            data: {
                name,
                slug: toSlug(name),
                architecture: "WEB",
                organizationId,
            },
            select: { id: true },
        });
    }

    /**
     * Returns the id of an active BranchSnapshot for the application, creating a
     * branch + snapshot if none exists yet. External runs don't map to a real git
     * SHA, so the snapshot is a synthetic MANUAL one.
     */
    private async findOrCreateActiveSnapshot(
        tx: Prisma.TransactionClient,
        organizationId: string,
        applicationId: string,
    ): Promise<string> {
        const existingSnapshot = await tx.branchSnapshot.findFirst({
            where: { branch: { applicationId }, status: "active" },
            orderBy: { createdAt: "desc" },
            select: { id: true },
        });
        if (existingSnapshot != null) return existingSnapshot.id;

        const branch =
            (await tx.branch.findFirst({
                where: { applicationId, name: DEFAULT_BRANCH_NAME },
                select: { id: true },
            })) ??
            (await tx.branch.create({
                data: { name: DEFAULT_BRANCH_NAME, applicationId, organizationId },
                select: { id: true },
            }));

        // Make this the app's main branch if it has none — otherwise the app is
        // filtered out of applications.list (which drops apps with no mainBranch),
        // and the dashboard's onboarding guard never lets you into it.
        await tx.application.updateMany({
            where: { id: applicationId, mainBranchId: null },
            data: { mainBranchId: branch.id },
        });

        const snapshot = await tx.branchSnapshot.create({
            data: { branchId: branch.id, status: "active", source: "MANUAL" },
            select: { id: true },
        });
        // Pin it as the branch's active snapshot — the app/runs views resolve through
        // branch.activeSnapshotId, not just a snapshot row with status=active.
        await tx.branch.update({ where: { id: branch.id }, data: { activeSnapshotId: snapshot.id } });
        return snapshot.id;
    }

    private async findOrCreateFolder(
        tx: Prisma.TransactionClient,
        organizationId: string,
        applicationId: string,
    ): Promise<string> {
        const existing = await tx.folder.findFirst({
            where: { applicationId, parentId: null, name: DEFAULT_FOLDER_NAME },
            select: { id: true },
        });
        if (existing != null) return existing.id;

        const folder = await tx.folder.create({
            data: { name: DEFAULT_FOLDER_NAME, applicationId, organizationId },
            select: { id: true },
        });
        return folder.id;
    }
}
