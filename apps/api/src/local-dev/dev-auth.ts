/**
 * Local-dev auth teardown.
 *
 * When LOCAL_DEV=true, the platform should be usable WITHOUT Google OAuth. This
 * seeds a single dev user + organization and exposes them so:
 *   - createContext() can inject them when no real session/API key is present
 *     (every protectedProcedure then passes as the dev user), and
 *   - the /v1/auth/get-session endpoint can be shimmed to return them, so the
 *     web UI's auth guard treats you as logged in.
 *
 * This path is gated on LOCAL_DEV and never runs in production.
 */
import { db } from "@autonoma/db";
import { env } from "../env";

export const LOCAL_DEV = env.LOCAL_DEV;

const DEV_USER_ID = "local-dev-user";
const DEV_ORG_ID = "local-dev-org";
const DEV_EMAIL = "dev@autonoma.app";

export interface DevIdentity {
    user: {
        id: string;
        name: string;
        email: string;
        emailVerified: boolean;
        image: string | null;
        role: string;
        createdAt: Date;
        updatedAt: Date;
    };
    session: {
        id: string;
        userId: string;
        token: string;
        expiresAt: Date;
        activeOrganizationId: string;
    };
    organization: {
        id: string;
        name: string;
        slug: string;
        logo: string | null;
        metadata: string | null;
        createdAt: Date;
    };
}

let cached: DevIdentity | null = null;

/** Seed (idempotently) and return the local-dev user + org + a synthetic session. */
export async function getOrCreateDevIdentity(): Promise<DevIdentity> {
    if (cached != null) return cached;

    const user = await db.user.upsert({
        where: { id: DEV_USER_ID },
        update: {},
        create: { id: DEV_USER_ID, email: DEV_EMAIL, name: "Local Dev", emailVerified: true, role: "admin" },
    });

    const org = await db.organization.upsert({
        where: { id: DEV_ORG_ID },
        update: {},
        create: { id: DEV_ORG_ID, name: "Local Dev", slug: "local-dev", domain: "local.dev", status: "approved" },
    });

    await db.member.upsert({
        where: { userId_organizationId: { userId: DEV_USER_ID, organizationId: DEV_ORG_ID } },
        update: {},
        create: { userId: DEV_USER_ID, organizationId: DEV_ORG_ID, role: "owner" },
    });

    cached = {
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            emailVerified: user.emailVerified,
            image: user.image ?? null,
            role: user.role,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        },
        session: {
            id: "local-dev-session",
            userId: DEV_USER_ID,
            token: "local-dev-session-token",
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
            activeOrganizationId: DEV_ORG_ID,
        },
        organization: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            logo: org.logo ?? null,
            metadata: org.metadata ?? null,
            createdAt: org.createdAt,
        },
    };
    return cached;
}
