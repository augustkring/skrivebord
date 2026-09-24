import { and, eq } from "drizzle-orm";
import type { SkrivebordDatabase } from "./client";
import {
  connectorAccount,
  connectorCredential
} from "./schema";

export type StoreConnectorCredentialInput = {
  workspaceId: string;
  connectorAccountId: string;
  encryptedPayload: string;
  keyId: string;
  expiresAt?: Date;
  rotatedAt?: Date;
  now?: Date;
};

export async function storeConnectorCredential(
  db: SkrivebordDatabase,
  input: StoreConnectorCredentialInput
): Promise<void> {
  const now = input.now ?? new Date();

  const [account] = await db
    .select({
      id: connectorAccount.id
    })
    .from(connectorAccount)
    .where(
      and(
        eq(connectorAccount.id, input.connectorAccountId),
        eq(connectorAccount.workspaceId, input.workspaceId)
      )
    )
    .limit(1);

  if (!account) {
    throw new Error("CONNECTOR_ACCOUNT_NOT_FOUND");
  }

  await db
    .insert(connectorCredential)
    .values({
      connectorAccountId: input.connectorAccountId,
      workspaceId: input.workspaceId,
      encryptedPayload: input.encryptedPayload,
      keyId: input.keyId,
      expiresAt: input.expiresAt,
      rotatedAt: input.rotatedAt,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: connectorCredential.connectorAccountId,
      set: {
        encryptedPayload: input.encryptedPayload,
        keyId: input.keyId,
        expiresAt: input.expiresAt,
        rotatedAt: input.rotatedAt ?? now,
        updatedAt: now
      }
    });
}

export async function readConnectorCredential(
  db: SkrivebordDatabase,
  input: {
    workspaceId: string;
    connectorAccountId: string;
  }
) {
  const [credential] = await db
    .select()
    .from(connectorCredential)
    .where(
      and(
        eq(
          connectorCredential.connectorAccountId,
          input.connectorAccountId
        ),
        eq(connectorCredential.workspaceId, input.workspaceId)
      )
    )
    .limit(1);

  return credential;
}
