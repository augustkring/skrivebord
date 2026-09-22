import type {
  ActionIntentRecord,
  ActionIntentState,
  ActionStore,
  AuditWrite,
  ApprovalRecord
} from "@skrivebord/actions";
import type { PrincipalContext } from "@skrivebord/contracts";
import type { Pool } from "pg";
import { PostgresActionStore } from "./action-store";
import { withPrincipalTransaction } from "./client";

export class TransactionalPostgresActionStore
  implements ActionStore
{
  constructor(
    private readonly pool: Pool,
    private readonly principal: PrincipalContext
  ) {}

  private run<T>(
    work: (store: PostgresActionStore) => Promise<T>
  ): Promise<T> {
    return withPrincipalTransaction(
      this.pool,
      this.principal,
      ({ db }) =>
        work(
          new PostgresActionStore(
            db,
            this.principal.workspaceId
          )
        )
    );
  }

  createIntent(intent: ActionIntentRecord): Promise<void> {
    return this.run((store) => store.createIntent(intent));
  }

  updateIntentState(
    intentId: string,
    state: ActionIntentState
  ): Promise<void> {
    return this.run((store) =>
      store.updateIntentState(intentId, state)
    );
  }

  createApproval(approval: ApprovalRecord): Promise<void> {
    return this.run((store) =>
      store.createApproval(approval)
    );
  }

  getApproval(
    id: string
  ): Promise<ApprovalRecord | undefined> {
    return this.run((store) => store.getApproval(id));
  }

  saveApproval(approval: ApprovalRecord): Promise<void> {
    return this.run((store) => store.saveApproval(approval));
  }

  appendAudit(event: AuditWrite): Promise<void> {
    return this.run((store) => store.appendAudit(event));
  }
}
