import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { api, fmtInr, fmtDate, badgeFor, statusLabel, STAGE_LABELS } from "../lib/api";
import { PageHeader, Card, DataTable, Badge, Modal, Field, type Column } from "../components/ui";
import { ImportExport } from "./gn/shared";

export default function Applications() {
  const nav = useNavigate();
  const [data, setData] = useState<any>({ rows: [], total: 0, stages: [] });
  const [stage, setStage] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<any>({ customer_id: null, product_id: null, requested_amount: 200000, tenure: 36, purpose: "" });

  const load = () => {
    const params = new URLSearchParams();
    if (stage) params.set("stage", stage);
    if (q) params.set("q", q);
    params.set("page", String(page));
    api(`/applications?${params}`).then(setData);
  };
  useEffect(load, [stage, q, page]);

  useEffect(() => {
    api("/customers?limit=100").then((r) => setCustomers(r.rows));
    api("/products").then(setProducts);
  }, []);

  const submit = async () => {
    const res = await api("/applications", { method: "POST", body: { ...form, requested_amount: Number(form.requested_amount), tenure: Number(form.tenure) } });
    setCreateOpen(false);
    nav(`/applications/${res.id}`);
  };

  const columns: Column<any>[] = [
    { key: "application_no", header: "Application", render: (r) => <span className="font-medium text-zinc-800">{r.application_no}</span> },
    { key: "customer", header: "Customer", sortValue: (r) => r.customer_name, render: (r) => (
      <div>
        <div className="font-medium text-zinc-800">{r.customer_name}</div>
        <div className="text-[10.5px] text-zinc-400">{r.mobile || ""}</div>
      </div>
    )},
    { key: "product", header: "Product", render: (r) => <span className="text-zinc-600">{r.product_name}</span> },
    { key: "amount", header: "Amount", align: "right", sortValue: (r) => r.requested_amount, render: (r) => <span className="num">{fmtInr(r.requested_amount)}</span> },
    { key: "stage", header: "Stage", render: (r) => (
      <div className="flex items-center gap-2">
        <Badge status={r.stage} />
        {r.needs_action === 1 && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" title="Needs action" />}
      </div>
    )},
    { key: "bre", header: "BRE", render: (r) => r.bre_result === "pending" ? <span className="text-zinc-300">—</span> : <Badge status={r.bre_result} /> },
    { key: "risk", header: "Risk", render: (r) => r.risk_grade ? <Badge status={r.risk_grade} /> : <span className="text-zinc-300">—</span> },
    { key: "docs", header: "Docs", align: "right", render: (r) => <span className="num text-zinc-500">{r.docs_verified}</span> },
    { key: "decision", header: "Decision", render: (r) => r.decision === "pending" ? <span className="text-zinc-300">—</span> : <Badge status={r.decision === "approve_with_conditions" ? "approved" : r.decision} /> },
    { key: "credit_officer", header: "Credit officer", render: (r) => r.credit_officer_name || <span className="text-zinc-300">Unassigned</span> },
    { key: "created_at", header: "Created", sortValue: (r) => r.created_at, render: (r) => <span className="text-zinc-500">{fmtDate(r.created_at)}</span> }
  ];

  return (
    <div>
      <PageHeader
        title="Loan applications"
        sub={`${data.total} applications across ${data.stages?.length} workflow stages`}
        breadcrumb="LOS / Applications"
        actions={
          <div className="flex items-center gap-2">
            <ImportExport entity="los_apps" onImported={load} />
            <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Plus size={14} /> New application</button>
          </div>
        }
      />

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button className={`btn ${stage === "" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}`} onClick={() => setStage("")}>All</button>
        {(data.stages || []).map((s: any) => (
          <button key={s.code} className={`btn ${stage === s.code ? "btn-primary btn-sm" : "btn-secondary btn-sm"}`} onClick={() => setStage(s.code)}>{s.name}</button>
        ))}
      </div>

      <Card>
        <DataTable
          columns={columns}
          rows={data.rows}
          total={data.total}
          page={page}
          limit={25}
          onPage={setPage}
          searchable
          searchPlaceholder="Search by application no, customer, mobile…"
          onSearch={(v) => { setQ(v); setPage(1); }}
          onRowClick={(r) => nav(`/applications/${r.id}`)}
          exportName="sniper-applications"
        />
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New application" wide>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Customer">
            <select className="input" value={form.customer_id ?? ""} onChange={(e) => setForm({ ...form, customer_id: Number(e.target.value) })}>
              <option value="">Select customer…</option>
              {customers.map((c2) => <option key={c2.id} value={c2.id}>{c2.name} ({c2.customer_no})</option>)}
            </select>
          </Field>
          <Field label="Product">
            <select className="input" value={form.product_id ?? ""} onChange={(e) => setForm({ ...form, product_id: Number(e.target.value) })}>
              <option value="">Select product…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Requested amount"><input className="input num" type="number" value={form.requested_amount} onChange={(e) => setForm({ ...form, requested_amount: e.target.value })} /></Field>
          <Field label="Tenure (months)"><input className="input num" type="number" value={form.tenure} onChange={(e) => setForm({ ...form, tenure: e.target.value })} /></Field>
          <Field label="Purpose" className="col-span-2"><input className="input" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Working capital, Home renovation…" /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!form.customer_id || !form.product_id}>Create application</button>
        </div>
      </Modal>
    </div>
  );
}
