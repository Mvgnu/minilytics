import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";

export type ReportSql = postgres.Sql | postgres.TransactionSql;
export const reportScope = new AsyncLocalStorage<{
  sql: ReportSql;
  rollups: Map<string, string>;
}>();
let client: postgres.Sql | undefined;
export function reportPool() {
  if (!client) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
    client = postgres(process.env.DATABASE_URL, {
      max: 3, idle_timeout: 20, connect_timeout: 10,
      connection: { application_name: "minilytics-reports", statement_timeout: 20000, timezone: "UTC" },
    });
  }
  return client;
}
export function reportDb(): ReportSql { return reportScope.getStore()?.sql ?? reportPool(); }
export function rollupKey(siteId: string, from: Date, to: Date) {
  return JSON.stringify([siteId, from.toISOString(), to.toISOString()]);
}
