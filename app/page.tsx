"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BATCH_SIZE, FAILURE_THRESHOLD, FAILURE_WAIT_MS, MAX_RETRY_ROUNDS, MAX_TABS,
} from "@/lib/config";
import { parseEmailCsv } from "@/lib/csv";
import { EmailRecord, Status, setResult } from "@/lib/records";
import { toReportCsv } from "@/lib/report";

interface TabInfo { number: number; completed: number; total: number; state: string; current: string }
type ApiResult = { email: string; status: Status; error: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmtEta = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
};

export default function Page() {
  const [url, setUrl] = useState("");
  const [tabCount, setTabCount] = useState(5);
  const [fileName, setFileName] = useState("");
  const [running, setRunning] = useState(false);
  const [round, setRound] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [, setTick] = useState(0);
  const [now, setNow] = useState(Date.now());

  const records = useRef<EmailRecord[]>([]);
  const stop = useRef(false);
  const startedAt = useRef<number | null>(null);
  const tabRef = useRef<Map<number, TabInfo>>(new Map());

  const log = (m: string) =>
    setLogs((l) => [...l.slice(-300), `[${new Date().toLocaleTimeString()}] ${m}`]);
  const bump = () => setTick((t) => t + 1);
  const pushTabs = () => setTabs([...tabRef.current.values()].sort((a, b) => a.number - b.number));

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => { setNow(Date.now()); bump(); }, 500);
    return () => clearInterval(id);
  }, [running]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    records.current = parseEmailCsv(await file.text());
    setRound(0);
    startedAt.current = null;
    bump();
    log(`Loaded ${records.current.length} rows from ${file.name}.`);
  }

  async function processRound(queue: EmailRecord[], retryRound: number) {
    const workers = Math.min(tabCount, MAX_TABS, queue.length);
    let next = 0;
    tabRef.current = new Map();
    const sizes = Array.from({ length: workers }, (_, i) =>
      Math.floor(queue.length / workers) + (i < queue.length % workers ? 1 : 0));
    sizes.forEach((total, i) =>
      tabRef.current.set(i + 1, { number: i + 1, completed: 0, total, state: "Processing", current: "Waiting" }));
    pushTabs();

    const worker = async (n: number) => {
      const tab = tabRef.current.get(n)!;
      let processed = 0, failures = 0;
      while (!stop.current) {
        const batch = queue.slice(next, next + BATCH_SIZE);
        if (!batch.length) break;
        next += batch.length;
        tab.state = "Processing";
        tab.current = batch[0].email;
        batch.forEach((r) => { r.tab = n; r.retryRound = retryRound; });
        pushTabs();

        let results: ApiResult[];
        try {
          const res = await fetch("/api/run-batch", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url, emails: batch.map((b) => b.email) }),
          });
          const data = await res.json();
          if (!res.ok) {
            stop.current = true;
            log(`Stopped: ${data.error ?? res.statusText}`);
            results = batch.map((b) => ({ email: b.email, status: "Pending", error: data.error ?? "Request rejected" }));
          } else {
            results = data.results;
          }
        } catch (e) {
          results = batch.map((b) => ({ email: b.email, status: "Pending", error: `Network error: ${(e as Error).message}` }));
        }

        for (const b of batch) {
          const r = results.find((x) => x.email === b.email) ?? { status: "Pending" as Status, error: "No result returned" };
          setResult(b, r.status, r.error);
          tab.completed += 1;
          processed += 1;
          if (r.status === "Fail") failures += 1;
        }
        tab.current = "Waiting";
        tab.state = tab.completed >= tab.total ? "Round complete" : "Processing";
        pushTabs();

        const pct = processed ? (failures / processed) * 100 : 0;
        if (pct > FAILURE_THRESHOLD && !stop.current) {
          tab.state = `Paused (${Math.round(pct)}% failures)`;
          pushTabs();
          log(`Tab ${n}: failure rate ${pct.toFixed(1)}%, pausing ${FAILURE_WAIT_MS / 1000}s.`);
          await sleep(FAILURE_WAIT_MS);
          processed = 0; failures = 0;
          log(`Tab ${n}: resuming with a fresh page.`);
        }
      }
    };
    await Promise.all(Array.from({ length: workers }, (_, i) => worker(i + 1)));
  }

  async function start() {
    if (!url.trim()) return log("Enter the landing page URL.");
    if (!records.current.length) return log("Choose a CSV with at least one email.");
    if (!records.current.some((r) => r.processable)) return log("No valid, unique emails to send.");
    if (records.current.some((r) => r.attempts > 0 && r.processable)) {
      // Re-run: reset attempt history by re-reading the file's rows.
      records.current = parseEmailCsv(records.current.map((r) => r.email).join("\n"));
    }
    startedAt.current = Date.now();
    stop.current = false;
    setRunning(true);
    setRound(0);

    let r = 0;
    let queue = records.current.filter((x) => x.processable);
    while (queue.length && !stop.current) {
      setRound(r);
      log(r === 0 ? `Starting with ${queue.length} emails.` : `Retry round ${r}: ${queue.length} emails.`);
      await processRound(queue, r);
      queue = records.current.filter((x) => x.processable && x.finalStatus !== "Success");
      if (r >= MAX_RETRY_ROUNDS) break;
      r += 1;
    }
    log(stop.current ? "Stopped." : "Finished. You can download the report.");
    setRunning(false);
    bump();
  }

  function download() {
    const blob = new Blob([toReportCsv(records.current)], { type: "text/csv" });
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    a.href = URL.createObjectURL(blob);
    a.download = `Paras_Resend_Report_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const s = useMemo(() => {
    const rs = records.current;
    const total = rs.length;
    const processed = rs.filter((r) => r.attempts > 0).length;
    const success = rs.filter((r) => r.finalStatus === "Success").length;
    const failed = rs.filter((r) => r.finalStatus === "Fail").length;
    const pending = rs.filter((r) => r.finalStatus === "Pending").length;
    const elapsed = startedAt.current ? (now - startedAt.current) / 1000 : 0;
    const speed = elapsed > 0 && success > 0 ? (success / elapsed) * 60 : 0;
    const eta = speed > 0 ? fmtEta(Math.max(0, Math.round(((total - success) / speed) * 60))) : "--:--:--";
    const pc = (n: number) => `${total ? ((n / total) * 100).toFixed(1) : "0.0"}%`;
    return { total, processed, success, failed, pending, speed, eta, pc };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, logs, tabs, running, fileName, round]);

  const rows = records.current.slice(0, 2000);

  return (
    <main>
      <h1>Paras Resend Tool</h1>

      <div className="card">
        <h2>Setup</h2>
        <div className="grid">
          <div>
            <label>Landing page URL</label>
            <input type="text" value={url} placeholder="https://register.example.com/"
              onChange={(e) => setUrl(e.target.value)} disabled={running} />
            <div className="hint">Any valid HTTP or HTTPS URL can be used.</div>
          </div>
          <div>
            <label>Email CSV (one email per row)</label>
            <input type="file" accept=".csv" onChange={(e) => onFile(e.target.files?.[0])} disabled={running} />
          </div>
          <div>
            <label>Parallel tabs (1–{MAX_TABS})</label>
            <input type="number" min={1} max={MAX_TABS} value={tabCount} disabled={running}
              onChange={(e) => setTabCount(Math.max(1, Math.min(MAX_TABS, Number(e.target.value) || 1)))} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={start} disabled={running}>Start</button>
          <button className="secondary" onClick={() => { stop.current = true; log("Stop requested…"); }} disabled={!running}>Stop</button>
          <button className="secondary" onClick={download} disabled={!records.current.length}>Download report</button>
          {fileName && <span className="hint">{fileName}</span>}
        </div>
      </div>

      <div className="card">
        <h2>Live dashboard</h2>
        <div className="stats">
          <div className="stat"><span>Total</span><b>{s.total}</b></div>
          <div className="stat"><span>Processed</span><b>{s.processed}</b></div>
          <div className="stat"><span>Success</span><b className="Success">{s.success}</b></div>
          <div className="stat"><span>Failed</span><b className="Fail">{s.failed}</b></div>
          <div className="stat"><span>Pending</span><b>{s.pending}</b></div>
          <div className="stat"><span>Success %</span><b>{s.pc(s.success)}</b></div>
          <div className="stat"><span>Fail %</span><b>{s.pc(s.failed)}</b></div>
          <div className="stat"><span>Pending %</span><b>{s.pc(s.pending)}</b></div>
          <div className="stat"><span>Time left</span><b>{s.eta}</b></div>
          <div className="stat"><span>Success/min</span><b>{s.speed.toFixed(2)}</b></div>
          <div className="stat"><span>Retry round</span><b>{round} / {MAX_RETRY_ROUNDS}</b></div>
        </div>
        <div className="bar"><div style={{ width: s.pc(s.success) }} /></div>
      </div>

      <div className="two">
        <div className="card">
          <h2>Tabs</h2>
          <div className="scroll">
            <table>
              <thead><tr><th>#</th><th>Progress</th><th>Status</th><th>Current</th></tr></thead>
              <tbody>
                {tabs.map((t) => (
                  <tr key={t.number}><td>{t.number}</td><td>{t.completed} / {t.total}</td><td>{t.state}</td><td>{t.current}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Automation log</h2>
          <div className="scroll"><pre className="log">{logs.join("\n")}</pre></div>
        </div>
      </div>

      <div className="card">
        <h2>Detailed email log</h2>
        <div className="scroll" style={{ maxHeight: 460 }}>
          <table>
            <thead>
              <tr><th>Email</th><th>Initial</th><th>Final</th><th>Attempts</th><th>Success</th><th>Fail</th>
                <th>Pending</th><th>Last error</th><th>Processed</th><th>Tab</th><th>Retry</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sourceRow}>
                  <td>{r.email}</td><td className={r.initialStatus}>{r.initialStatus}</td>
                  <td className={r.finalStatus}>{r.finalStatus}</td><td>{r.attempts}</td><td>{r.success}</td>
                  <td>{r.fail}</td><td>{r.pending}</td><td>{r.lastError}</td><td>{r.lastProcessed}</td>
                  <td>{r.tab || ""}</td><td>{r.retryRound}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {records.current.length > 2000 && <div className="hint">Showing first 2000 rows; the downloaded report has all of them.</div>}
      </div>
    </main>
  );
}
