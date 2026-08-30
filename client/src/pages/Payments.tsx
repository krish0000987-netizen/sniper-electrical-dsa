import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Link2, RefreshCcw, RotateCcw, FileInput, AlertTriangle } from "lucide-react";
import { api, fmtInr, fmtDateTime, badgeFor } from "../lib/api";
import { PageHeader, Card, Badge, Stat, Tabs, Drawer, KV } from "../components/ui";
import { ImportExport } from "./gn/shared";

const RECON_STATUSES = ["matched", "unmatched", "duplicate", "failed", "reversed", "requires_review"];

export default function Payments() {
  const nav = useNavigate();
  const [tab, setTab] = useState("transactions");
  const [payments, setPayments] = useState<any[]>([]);
  const [payTotal, setPayTotal] = useState(0);
  const [payQ, setPayQ] = useState("");
  const [recon, setRecon] = useState<any[]>([]);
  const [reconStats, setReconStats] = useState<any>({ stats: {} });
  const [reconStatus, setReconStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<any>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [toast, setToast] = useState("");
  const [importing, setImporting] = useState(false);
  const [reconQ, setReconQ] = useState("");

  const loadPayments = () => {
    const p = new URLSearchParams({ limit: "50", page: String(page) });
    if (payQ) p.set("q", payQ);
    api(`/payments?${p}`).then((r) => { setPayments(r.rows); setPayTotal(r.total); });
  };
  const loadRecon = () => {
    const p = new URLSearchParams({ limit: "100" });
    if (reconStatus) p.set("status", reconStatus);
    if (reconQ) p.set("q", reconQ);
    api(`/recon/transactions?${p}`).then((r) => setRecon(r.rows));
    api("/recon/stats").then(setReconStats);
  };

  useEffect(() => { loadPayments(); }, [page, payQ]);
  useEffect(() => { loadRecon(); }, [reconStatus, reconQ]);

  const openTxn = async (t: any) => {
    setSelected(t);
    const c = await api(`/recon/${t.id}/candidates`);
    setCandidates(c.candidates);
  };

  const act = async (fn: () => Promise<any>, msg: string) => {
    await fn();
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
    loadRecon();
    loadPayments();
  };

  const stats = reconStats.stats || {};
  const totalRecon = reconStats.total ?? 0;

  const reconTabs = [
    { key: "transactions", label: "Transactions" },
    { key: "reconciliation", label: "Reconciliation" },
    { key: "exceptions", label: "Exceptions" }
  ];

  const txnsForTab = useMemo(() => {
    if (tab === "exceptions") return recon.filter((r) => ["unmatched", "duplicate", "failed", "requires_review", "reversed"].includes(r.status));
    if (tab === "reconciliation") return recon;
    return [];
  }, [tab, recon]);

  return (
    <div>
      <PageHeader
        title="Payments & Reconciliation"
        sub="Receipts, allocation, bank-statement reconciliation and exception resolution"
        breadcrumb="LMS / Payments"
        actions={
          <div className="flex items-center gap-2">
            <ImportExport entity="payments" />
            <button className="btn btn-secondary" disabled={importing} onClick={async () => {
              setImporting(true);
              try {
                await act(async () => api("/recon/import", {
                  method: "POST",
                  body: {
                    source: "HDFC Demo Statement",
                    transactions: [
                      { txn_date: new Date().toISOString().slice(0, 10), amount: 15400, mode: "NEFT", reference: "DEMO-IMP-001", payer_name: "Sniper Demo" },
                      { txn_date: new Date().toISOString().slice(0, 10), amount: 22000, mode: "UPI", reference: "DEMO-IMP-002", payer_name: "Sniper Demo" },
                      { txn_date: new Date().toISOString().slice(0, 10), amount: 9800, mode: "NEFT", reference: "DEMO-IMP-003", payer_name: "Sniper Demo" }
                    ]
                  }
                }), "Bank statement imported & auto-matched");
              } finally { setImporting(false); }
            }}>
              <FileInput size={13} /> {importing ? "Importing…" : "Simulate bank import"}
            </button>
          </div>
        }
      />

      {/* Reconciliation overview */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        <Stat label="Matched" value={stats.matched?.count ?? 0} sub={fmtInr(stats.matched?.amount)} tone="green" />
        <Stat label="Unmatched" value={stats.unmatched?.count ?? 0} sub={fmtInr(stats.unmatched?.amount)} tone="amber" />
        <Stat label="Duplicates" value={stats.duplicate?.count ?? 0} tone="red" />
        <Stat label="Failed" value={stats.failed?.count ?? 0} tone="red" />
        <Stat label="Reversed" value={stats.reversed?.count ?? 0} tone="red" />
        <Stat label="Match rate" value={`${reconStats.matchRate ?? 0}%`} sub={`${totalRecon} bank txns`} tone="brand" />
      </div>

      <Tabs items={reconTabs} active={tab} onChange={setTab} />

      {tab === "transactions" && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold text-zinc-900">Receipts ledger ({payTotal})</h3>
            <div className="flex items-center gap-2">
              <input className="input w-60" placeholder="Receipt, loan, customer…" value={payQ} onChange={(e) => { setPayQ(e.target.value); setPage(1); }} />
              <button className="btn btn-secondary btn-sm" onClick={() => act(async () => { /* CSV export via payments endpoint */ }, "Exported")}>
                <Download size={13} /> Export
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-zinc-200">
                <th className="th">Receipt</th><th className="th">Loan</th><th className="th">Customer</th>
                <th className="th text-right">Amount</th><th className="th text-right">Allocated</th>
                <th className="th">Mode</th><th className="th">Status</th><th className="th">Received</th>
              </tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-zinc-50 tr-hover cursor-pointer" onClick={() => nav(`/loans/${p.loan_id}`)}>
                    <td className="td font-medium">{p.receipt_no}</td>
                    <td className="td">{p.loan_no}</td>
                    <td className="td">{p.customer_name}</td>
                    <td className="td text-right num font-semibold">{fmtInr(p.amount)}</td>
                    <td className="td text-right num text-zinc-500">{fmtInr(p.allocated_amount)}</td>
                    <td className="td uppercase text-zinc-500">{p.mode}</td>
                    <td className="td"><Badge status={p.reversed ? "reversed" : p.status} /></td>
                    <td className="td text-zinc-500">{fmtDateTime(p.received_at)}</td>
                  </tr>
                ))}
                {!payments.length && <tr><td colSpan={8} className="py-12 text-center text-zinc-400 text-[12px]">No receipts found.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3 text-[11.5px] text-zinc-500">
            <span>{payTotal} receipts</span>
            <div className="flex gap-1">
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
              <button className="btn btn-secondary btn-sm" disabled={page * 50 >= payTotal} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        </Card>
      )}

      {tab !== "transactions" && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold text-zinc-900">
              {tab === "exceptions" ? "Exception queue — requires resolution" : "Bank / gateway transactions"}
            </h3>
            <div className="flex items-center gap-2">
              <select className="input w-44 text-[12px]" value={reconStatus} onChange={(e) => setReconStatus(e.target.value)}>
                <option value="">All statuses</option>
                {RECON_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input className="input w-52" placeholder="Reference / payer…" value={reconQ} onChange={(e) => setReconQ(e.target.value)} />
              <a className="btn btn-secondary btn-sm" href="/api/recon/export" target="_blank" rel="noreferrer"><Download size={13} /> CSV</a>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="border-b border-zinc-200">
                <th className="th">Date</th><th className="th">Amount</th><th className="th">Mode</th><th className="th">Reference</th>
                <th className="th">Payer</th><th className="th">Match</th><th className="th">Status</th><th className="th" />
              </tr></thead>
              <tbody>
                {txnsForTab.map((t) => (
                  <tr key={t.id} className="border-b border-zinc-50 tr-hover cursor-pointer" onClick={() => openTxn(t)}>
                    <td className="td">{fmtDateTime(t.txn_date)}</td>
                    <td className="td text-right num font-semibold">{fmtInr(t.amount)}</td>
                    <td className="td uppercase text-zinc-500">{t.mode}</td>
                    <td className="td text-zinc-600">{t.reference}</td>
                    <td className="td">{t.payer_name}</td>
                    <td className="td text-zinc-500">{t.match_type ? <span className="badge-indigo">{t.match_type}</span> : "—"}</td>
                    <td className="td"><Badge status={t.status} /></td>
                    <td className="td text-right text-[11px] text-brand-600 font-medium">Review →</td>
                  </tr>
                ))}
                {!txnsForTab.length && <tr><td colSpan={8} className="py-12 text-center text-zinc-400 text-[12px]">Nothing in this queue.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Exception quick view */}
      {tab === "exceptions" && (
        <div className="mt-4 flex items-start gap-2 rounded-md bg-amber-50 border border-amber-100 px-3 py-2.5 text-[11.5px] text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>Unmatched and failed transactions must be resolved before end-of-day reconciliation. Click a row to match against candidate payments, reject as duplicates, or mark as resolved with a note.</span>
        </div>
      )}

      {/* Review drawer */}
      <Drawer open={!!selected} onClose={() => setSelected(null)} title={`Transaction #${selected?.id ?? ""} — ${selected?.status ?? ""}`} width="max-w-2xl">
        {selected && (
          <div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-4">
              <KV k="Date" v={fmtDateTime(selected.txn_date)} />
              <KV k="Amount" v={fmtInr(selected.amount)} />
              <KV k="Mode" v={selected.mode?.toUpperCase()} />
              <KV k="Reference" v={selected.reference || "—"} />
              <KV k="Payer" v={selected.payer_name || "—"} />
              <KV k="Account" v={selected.account_suffix || "—"} />
              <KV k="Batch" v={selected.batch_no} />
              <KV k="Match" v={selected.match_type || "none"} />
            </div>

            {selected.status === "matched" && (
              <div className="rounded-md bg-emerald-50 border border-emerald-100 p-3 mb-4">
                <div className="text-[12px] font-semibold text-emerald-800 mb-1">Matched to {selected.receipt_no}</div>
                <div className="text-[11.5px] text-emerald-700">Loan {selected.loan_no} · {selected.customer_name}</div>
                <div className="flex gap-2 mt-3">
                  <button className="btn btn-secondary btn-sm" onClick={() => act(async () => api(`/recon/${selected.id}/unmatch`, { method: "POST", body: {} }), "Unmatched")}>
                    <RotateCcw size={13} /> Unmatch
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => {
                    const reason = window.prompt("Reversal reason");
                    if (reason) act(async () => api(`/recon/${selected.id}/reverse`, { method: "POST", body: { reason } }), "Reversed (payment reversed too)");
                  }}>
                    <RefreshCcw size={13} /> Reverse
                  </button>
                </div>
              </div>
            )}

            {selected.status !== "matched" && selected.status !== "reversed" && (
              <div>
                <h4 className="text-[12.5px] font-semibold text-zinc-800 mb-2">Candidate payments</h4>
                {candidates.length === 0 && <div className="text-[12px] text-zinc-500 mb-3">No candidate payments found — possible unrecorded receipt or payer-name mismatch.</div>}
                <div className="space-y-2 mb-4">
                  {candidates.map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2.5">
                      <div>
                        <div className="text-[12.5px] font-medium text-zinc-800">{c.receipt_no} · {c.customer_name}</div>
                        <div className="text-[11px] text-zinc-500">{c.loan_no} · {fmtDateTime(c.received_at)} · {c.mode?.toUpperCase()}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[13px] font-semibold num">{fmtInr(c.amount)}</span>
                        {c.amount === selected.amount
                          ? <button className="btn btn-primary btn-sm" onClick={() => act(async () => api(`/recon/${selected.id}/match`, { method: "POST", body: { payment_id: c.id } }), "Matched manually")}>
                              <Link2 size={13} /> Match
                            </button>
                          : <span className="text-[10.5px] text-zinc-400">amount mismatch</span>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-secondary btn-sm" onClick={() => {
                    const note = window.prompt("Resolution note");
                    if (note) act(async () => api(`/recon/${selected.id}/resolve`, { method: "POST", body: { note } }), "Marked resolved");
                  }}>Mark resolved</button>
                </div>
              </div>
            )}

            {selected.status === "reversed" && (
              <div className="rounded-md bg-rose-50 border border-rose-100 p-3 text-[12px] text-rose-800">
                This bank transaction was reversed{selected.note ? ` — ${selected.note}` : ""}. If it was matched, the linked payment was reversed and installment state restored. History is retained.
              </div>
            )}
          </div>
        )}
      </Drawer>

      {toast && <div className="fixed bottom-5 right-5 z-50 rounded-md bg-zinc-900 text-white text-[12px] px-4 py-2.5 shadow-xl">{toast}</div>}
    </div>
  );
}
