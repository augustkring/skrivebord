import type { ActionDefinition } from "@skrivebord/actions";
import {
  CompleteWorkItemInputSchema,
  type CompleteWorkItemInput
} from "@skrivebord/contracts";
import { and, eq } from "drizzle-orm";
import type { SkrivebordDatabase } from "./client";
import { workItem } from "./schema";

export type CompleteWorkItemResult = {
  workItemId: string;
  status: "DONE";
  completedAt: string;
};

export function createCompleteWorkItemAction(
  db: SkrivebordDatabase
): ActionDefinition<CompleteWorkItemInput, CompleteWorkItemResult> {
  return {
    id: "today.complete",
    input: CompleteWorkItemInputSchema,
    requiredCapabilities: ["today.manage"],
    risk: () => "LOW",
    reversible: true,
    authorize: async ({ principal, input }) => {
      if (principal.workspaceId !== input.workspaceId) return false;

      const [row] = await db
        .select({
          id: workItem.id
        })
        .from(workItem)
        .where(
          and(
            eq(workItem.id, input.workItemId),
            eq(workItem.workspaceId, principal.workspaceId)
          )
        )
        .limit(1);

      return Boolean(row);
    },
    preview: async () => "Markér arbejdet som færdigt",
    execute: async ({ principal, input, now }) => {
      const [current] = await db
        .select({
          id: workItem.id,
          status: workItem.status,
          completedAt: workItem.completedAt
        })
        .from(workItem)
        .where(
          and(
            eq(workItem.id, input.workItemId),
            eq(workItem.workspaceId, principal.workspaceId)
          )
        )
        .limit(1);

      if (!current) {
        throw new Error("WORK_ITEM_NOT_FOUND");
      }

      if (current.status === "DONE") {
        return {
          workItemId: current.id,
          status: "DONE",
          completedAt: (
            current.completedAt ?? now
          ).toISOString()
        };
      }

      if (
        current.status === "DISMISSED" ||
        current.status === "EXPIRED"
      ) {
        throw new Error("WORK_ITEM_NOT_COMPLETABLE");
      }

      const [updated] = await db
        .update(workItem)
        .set({
          status: "DONE",
          completedAt: now,
          updatedAt: now
        })
        .where(
          and(
            eq(workItem.id, input.workItemId),
            eq(workItem.workspaceId, principal.workspaceId)
          )
        )
        .returning({
          id: workItem.id,
          completedAt: workItem.completedAt
        });

      if (!updated) {
        throw new Error("WORK_ITEM_UPDATE_FAILED");
      }

      return {
        workItemId: updated.id,
        status: "DONE",
        completedAt: (
          updated.completedAt ?? now
        ).toISOString()
      };
    }
  };
}
