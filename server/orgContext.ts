import { AsyncLocalStorage } from "node:async_hooks";

export interface OrgContext {
  orgId: number;
  superAdmin: boolean;
  bypassScope?: boolean;
}

const als = new AsyncLocalStorage<OrgContext>();

export function runWithOrg<T>(ctx: OrgContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getOrgContext(): OrgContext | undefined {
  return als.getStore();
}

export function currentOrgId(): number | null {
  const ctx = als.getStore();
  if (!ctx) return null;
  if (ctx.bypassScope) return null;
  return ctx.orgId;
}
