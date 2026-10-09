import { EmailRecord } from "./records";

const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

export function toReportCsv(records: EmailRecord[]): string {
  const head = ["Email", "Final Status", "Attempt Count", "Success Count", "Fail Count",
    "Pending Count", "Last Error", "Tab Number", "Final Retry Round"];
  const rows = records.map((r) => [r.email, r.finalStatus, r.attempts, r.success, r.fail,
    r.pending, r.lastError, r.tab || "", r.retryRound].map(esc).join(","));
  return [head.map(esc).join(","), ...rows].join("\n");
}
