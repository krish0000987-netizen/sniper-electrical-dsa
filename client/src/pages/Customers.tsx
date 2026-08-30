import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { api, fmtInr, badgeFor, statusLabel } from "../lib/api";
import { PageHeader, Card, DataTable, Badge, Modal, Field, type Column } from "../components/ui";
import { ImportExport } from "./gn/shared";

export default function Customers() {
  const nav = useNavigate();
  const [data, setData] = useState<any>({ rows: [], total: 0 });
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: "", mobile: "", email: "", city: "", state: "", employment_type: "salaried", annual_income: "", monthly_income: "" });

  const load = () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("page", String(page));
    api(`/customers?${params}`).then(setData);
  };
  useEffect(load, [q, page]);

  const addCustomer = async () => {
    await api("/customers", { method: "POST", body: { ...form, annual_income: Number(form.annual_income) || null, monthly_income: Number(form.monthly_income) || null } });
    setAddOpen(false);
    setForm({ name: "", mobile: "", email: "", city: "", state: "", employment_type: "salaried", annual_income: "", monthly_income: "" });
    load();
  };

  const columns: Column<any>[] = [
    { key: "customer_no", header: "Customer ID", render: (r) => <span className="font-medium text-zinc-800">{r.customer_no}</span> },
    { key: "name", header: "Name", sortValue: (r) => r.name, render: (r) => (
      <div>
        <div className="font-medium text-zinc-800">{r.name}</div>
        <div className="text-[10.5px] text-zinc-400">{r.mobile || ""}</div>
      </div>
    )},
    { key: "city", header: "Location", render: (r) => <span className="text-zinc-600">{r.city ? `${r.city}, ${r.state}` : "—"}</span> },
    { key: "employment", header: "Profile", render: (r) => <span className="capitalize text-zinc-600">{r.employment_type || "—"}</span> },
    { key: "credit_score", header: "Credit score", align: "right", sortValue: (r) => r.credit_score, render: (r) => r.credit_score ? (
      <span className={`num font-semibold ${r.credit_score >= 750 ? "text-emerald-600" : r.credit_score >= 650 ? "text-amber-600" : "text-rose-600"}`}>{r.credit_score}</span>
    ) : <span className="text-zinc-300">—</span>},
    { key: "risk", header: "Risk", render: (r) => <Badge status={r.risk_class} /> },
    { key: "kyc", header: "KYC", render: (r) => <Badge status={r.kyc_status} /> },
    { key: "loans", header: "Active loans", align: "right", render: (r) => <span className="num">{r.active_loans}</span> },
    { key: "apps", header: "Applications", align: "right", render: (r) => <span className="num">{r.applications_count}</span> },
    { key: "status", header: "Status", render: (r) => <Badge status={r.status} /> }
  ];

  return (
    <div>
      <PageHeader title="Customers" sub={`${data.total} customer profiles · complete 360 view`} breadcrumb="CRM / Customers" actions={
        <div className="flex items-center gap-2">
          <ImportExport entity="customers" onImported={load} />
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}><Plus size={14} /> Add customer</button>
        </div>
      } />
      <Card>
        <DataTable
          columns={columns}
          rows={data.rows}
          total={data.total}
          page={page}
          limit={25}
          onPage={setPage}
          searchable
          searchPlaceholder="Search by name, mobile, PAN, customer ID…"
          onSearch={(v) => { setQ(v); setPage(1); }}
          onRowClick={(r) => nav(`/customers/${r.id}`)}
          exportName="sniper-customers"
        />
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add customer — manual entry">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full name *"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Mobile"><input className="input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></Field>
            <Field label="Email"><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Employment type">
              <select className="input" value={form.employment_type} onChange={(e) => setForm({ ...form, employment_type: e.target.value })}>
                <option value="salaried">Salaried</option><option value="self_employed">Self employed</option><option value="business">Business</option><option value="professional">Professional</option>
              </select>
            </Field>
            <Field label="City"><input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
            <Field label="State"><input className="input" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></Field>
            <Field label="Annual income (₹)"><input className="input" type="number" value={form.annual_income} onChange={(e) => setForm({ ...form, annual_income: e.target.value })} /></Field>
            <Field label="Monthly income (₹)"><input className="input" type="number" value={form.monthly_income} onChange={(e) => setForm({ ...form, monthly_income: e.target.value })} /></Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-secondary" onClick={() => setAddOpen(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={!form.name} onClick={addCustomer}>Save customer</button>
        </div>
      </Modal>
    </div>
  );
}
