import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { resolveSystemPrincipal } from "@skrivebord/auth";
import {
  withPrincipalTransaction,
  workspaceProfile
} from "@skrivebord/database";
import { betterAuth } from "better-auth";
import { magicLink, organization } from "better-auth/plugins";
import { Pool } from "pg";
import { sendAuthMail } from "./auth-mail";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const databaseURL =
  process.env.DATABASE_URL ??
  "postgresql://build_only:build_only@127.0.0.1:5432/build_only";
const secret =
  process.env.BETTER_AUTH_SECRET ??
  "build-only-secret-not-valid-for-runtime-000000000000";

const pool = new Pool({
  connectionString: databaseURL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

async function syncWorkspaceProfile(organization: {
  id: string;
  slug: string;
  name: string;
}) {
  const principal = resolveSystemPrincipal(
    {
      jobId: "system:organization-sync",
      workspaceId: organization.id,
      capabilities: []
    },
    crypto.randomUUID()
  );

  await withPrincipalTransaction(
    pool,
    principal,
    async ({ db }) => {
      await db
        .insert(workspaceProfile)
        .values({
          workspaceId: organization.id,
          slug: organization.slug,
          displayName: organization.name
        })
        .onConflictDoUpdate({
          target: workspaceProfile.workspaceId,
          set: {
            slug: organization.slug,
            displayName: organization.name,
            updatedAt: new Date()
          }
        });
    }
  );
}

export const authRuntimeStatus = {
  databaseConfigured: Boolean(process.env.DATABASE_URL),
  secretConfigured: Boolean(process.env.BETTER_AUTH_SECRET),
  baseURLConfigured: Boolean(process.env.BETTER_AUTH_URL),
  mailConfigured: Boolean(process.env.AUTH_MAIL_WEBHOOK_URL),
  get coreConfigured() {
    return (
      this.databaseConfigured &&
      this.secretConfigured &&
      this.baseURLConfigured
    );
  }
};

export const auth = betterAuth({
  appName: "Skrivebord",
  baseURL,
  secret,
  database: pool,
  rateLimit: {
    enabled: true
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: false,
      requireEmailVerificationOnInvitation: true,
      invitationExpiresIn: 60 * 60 * 48,
      organizationHooks: {
        async afterCreateOrganization({ organization }) {
          await syncWorkspaceProfile(organization);
        },
        async afterUpdateOrganization({ organization }) {
          await syncWorkspaceProfile(organization);
        }
      },
      async sendInvitationEmail(data) {
        const inviteLink =
          `${baseURL}/accept-invitation/${encodeURIComponent(data.id)}`;

        await sendAuthMail({
          to: data.email,
          subject:
            `Invitation til ${data.organization.name} i Skrivebord`,
          text:
            `${data.inviter.user.name} har inviteret dig til ${data.organization.name} i Skrivebord. Åbn invitationen: ${inviteLink}`
        });
      }
    }),
    apiKey([
      {
        configId: "agent-keys",
        defaultPrefix: "mojn_",
        references: "organization"
      }
    ]),
    passkey({
      rpID: new URL(baseURL).hostname,
      rpName: "Skrivebord"
    }),
    magicLink({
      expiresIn: 60 * 15,
      async sendMagicLink({ email, url }) {
        await sendAuthMail({
          to: email,
          subject: "Log ind på Skrivebord",
          text:
            `Brug dette sikre link til at logge ind på Skrivebord: ${url}\n\nLinket udløber om 15 minutter.`
        });
      }
    })
  ]
});
