import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Phone, Filter } from "lucide-react";
import { api, fmtInr, fmtDate, badgeFor, statusLabel } from "../lib/api";
import { PageHeader, Card, DataTable, Modal, Field, Badge, type Column } from "../components/ui";

const SOURCES = ["website", "meta", "google", "whatsapp", "call", "referral", "dsa", "field", "branch", "walkin", "partner", "aggregator"];
const LOAN_TYPES = ["personal", "business", "msme", "lap", "home", "vehicle", "working_capital", "invoice", "microfinance", "gold"];
const STATUSES = ["new", "assigned", "contacted", "interested", "followup", "converted", "dnd", "wrong_number", "lost", "not_interested"];

export default function Leads() {
  const nav = useNavigate();
  const [data, setData] = useState<any>({ rows: [], total: 0 });
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [stats, setStats] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ name: "", mobile: "", loan_type: "personal", requested_amount: 200000, source: "walkin" });

  const load = () => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (source) params.set("source", source);
    if (q) params.set("q", q);
    params.set("page", String(page));
    params.set("limit", "25");
    api(`/leads?${params}`).then(setData);
  };
  useEffect(load, [status, source, q, page]);
  useEffect(() => { api("/leads/stats").then(setStats); api("/products").then(setProducts); }, []);

  const submit = async () => {
    await api("/leads", { method: "POST", body: { ...form, requested_amount: Number(form.requested_amount), monthly_income: form.monthly_income ? Number(form.monthly_income) : undefined } });
    setCreateOpen(false);
    setForm({ name: "", mobile: "", loan_type: "personal", requested_amount: 200000, source: "walkin" });
    load();
  };

  const columns: Column<any>[] = [
    { key: "lead_no", header: "Lead ID", render: (r) => <span className="font-medium text-zinc-800">{r.lead_no}</span> },
    { key: "name", header: "Customer", sortValue: (r) => r.name, render: (r) => (
      <div>
        <div className="font-medium text-zinc-800">{r.name}</div>
        <div className="text-[10.5px] text-zinc-400">{r.mobile || ""}</div>
      </div>
    )},
    { key: "loan_type", header: "Product", render: (r) => <span className="capitalize">{r.loan_type}</span> },
    { key: "requested_amount", header: "Amount", align: "right", sortValue: (r) => r.requested_amount, render: (r) => <span className="num">{fmtInr(r.requested_amount)}</span> },
    { key: "source", header: "Source", render: (r) => <span className="capitalize text-zinc-500">{r.source}</span> },
    { key: "owner", header: "Owner", render: (r) => r.owner_name || <span className="text-zinc-300">Unassigned</span> },
    { key: "score", header: "Score", align: "right", sortValue: (r) => r.score, render: (r) => (
      <div className="flex items-center justify-end gap-1.5">
        <div className="w-10 h-1 bg-zinc-100 rounded-full overflow-hidden"><div className={`h-full ${r.score >= 70 ? "bg-emerald-500" : r.score >= 45 ? "bg-amber-500" : "bg-zinc-300"}`} style={{ width: `${r.score}%` }} /></div>
        <span className="num text-[11.5px] font-semibold">{r.score}</span>
      </div>
    )},
    { key: "status", header: "Status", render: (r) => <Badge status={r.status} /> },
    { key: "followup_at", header: "Follow-up", render: (r) => <span className="text-zinc-500">{fmtDate(r.followup_at)}</span> },
    { key: "created_at", header: "Created", sortValue: (r) => r.created_at, render: (r) => <span className="text-zinc-500">{fmtDate(r.created_at)}</span> }
  ];

  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {};
    stats.forEach((s) => { m[s.status] = s.n; });
    return m;
  }, [stats]);

  return (
    <div>
      <PageHeader
        title="Leads"
        sub={`${data.total} leads in pipeline · scored & prioritized`}
        breadcrumb="CRM"
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => nav("/telecall")}><Phone size={13} /> Telecalling</button>
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Plus size={14} /> New lead</button>
          </>
        }
      />

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button className={`btn ${status === "" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}`} onClick={() => setStatus("")}>All · {data.total}</button>
        {STATUSES.filter((s) => statusCounts[s]).map((s) => (
          <button key={s} className={`btn ${status === s ? "btn-primary btn-sm" : "btn-secondary btn-sm"}`} onClick={() => setStatus(s)}>
            {statusLabel(s)} · {statusCounts[s]}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Filter size={13} className="text-zinc-400" />
          <select className="input w-auto text-[12px]" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            {SOURCES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
        <DataTable
          columns={columns}
          rows={data.rows}
          total={data.total}
          page={page}
          limit={25}
          onPage={setPage}
          searchable
          searchPlaceholder="Search by name, mobile, lead ID…"
          onSearch={(v) => { setQ(v); setPage(1); }}
          onRowClick={(r) => nav(`/leads/${r.id}`)}
          exportName="sniper-leads"
        />
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New lead">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Mobile"><input className="input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></Field>
          <Field label="Loan type">
            <select className="input" value={form.loan_type} onChange={(e) => setForm({ ...form, loan_type: e.target.value })}>
              {LOAN_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
          </Field>
          <Field label="Requested amount"><input className="input num" type="number" value={form.requested_amount} onChange={(e) => setForm({ ...form, requested_amount: e.target.value })} /></Field>
          <Field label="Monthly income"><input className="input num" type="number" value={form.monthly_income || ""} onChange={(e) => setForm({ ...form, monthly_income: e.target.value })} /></Field>
          <Field label="Source">
            <select className="input" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              {SOURCES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!form.name}>Create lead</button>
        </div>
      </Modal>
    </div>
  );
}
