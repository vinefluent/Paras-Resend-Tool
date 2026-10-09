export type Status = "Pending" | "Success" | "Fail";

export interface EmailRecord {
  email: string;
  sourceRow: number;
  initialStatus: Status;
  finalStatus: Status;
  attempts: number;
  success: number;
  fail: number;
  pending: number;
  lastError: string;
  lastProcessed: string;
  tab: number;
  retryRound: number;
  processable: boolean;
}

export function newRecord(email: string, sourceRow: number): EmailRecord {
  return {
    email, sourceRow, initialStatus: "Pending", finalStatus: "Pending",
    attempts: 0, success: 0, fail: 0, pending: 0, lastError: "",
    lastProcessed: "", tab: 0, retryRound: 0, processable: true,
  };
}

export function setResult(r: EmailRecord, status: Status, error = ""): void {
  if (r.attempts === 0) r.initialStatus = status;
  r.attempts += 1;
  r.finalStatus = status;
  r.lastError = error;
  r.lastProcessed = new Date().toLocaleString("sv-SE"); // YYYY-MM-DD HH:mm:ss
  if (status === "Success") r.success += 1;
  else if (status === "Fail") r.fail += 1;
  else r.pending += 1;
}
