import { EMAIL_PATTERN } from "./config";
import { EmailRecord, newRecord, setResult } from "./records";

/** One email per row (first column). Invalid/duplicate rows are kept as final Fail. */
export function parseEmailCsv(text: string): EmailRecord[] {
  const records: EmailRecord[] = [];
  const seen = new Set<string>();
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((line, i) => {
    const rowNumber = i + 1;
    const value = (line.split(",")[0] ?? "").trim().replace(/^"|"$/g, "").trim().toLowerCase();
    if (!value) return;
    if (rowNumber === 1 && value === "email") return;
    const rec = newRecord(value, rowNumber);
    if (!EMAIL_PATTERN.test(value)) {
      rec.processable = false;
      setResult(rec, "Fail", "Invalid email format in CSV");
    } else if (seen.has(value)) {
      rec.processable = false;
      setResult(rec, "Fail", "Duplicate email in CSV");
    } else {
      seen.add(value);
    }
    records.push(rec);
  });
  return records;
}
