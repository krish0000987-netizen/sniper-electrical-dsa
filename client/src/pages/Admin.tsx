import { useEffect, useState } from "react";
import { api, fmtDate } from "../lib/api";
import { PageHeader, Card, CardTitle, Badge, Tabs, Modal, Field, DataTable, type Column } from "../components/ui";

const ROLE_LABELS_L: Record<string, string> = {
  super_admin: "Super Admin", tenant_admin: "Tenant Admin", branch_admin: "Branch Admin",
  sales_manager: "Sales Manager", telecaller: "Telecaller", field_executive: "Field Executive",
  credit_analyst: "Credit Analyst", credit_manager: "Credit Manager", underwriter: "Underwriter",
  operations: "Operations", collection_manager: "Collection Manager", collection_agent: "Collection Agent",
  dsa: "DSA Partner", finance: "Finance", auditor: "Auditor", compliance_officer: "Compliance Officer", customer_support: "Customer Support"
};

export default function Admin() {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState<any>({ rows: [], roles: {}, roleLabels: {} });
  const [products, setProducts] = useState<any[]>([]);
  const [workflow, setWorkflow] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);
  const [audit, setAudit] = useState<any>({ rows: [], total: 0 });
  const [wfBuilder, setWfBuilder] = useState<any[]>([]);
  const [wfMsg, setWfMsg] = useState("");
  const [userOpen, setUserOpen] = useState(false);
  const [userForm, setUserForm] = useState<any>({ name: "", email: "", password: "demo1234", role: "credit_analyst", branch_id: null });
  const [productOpen, setProductOpen] = useState(false);
  const [productForm, setProductForm] = useState<any>({ code: "", name: "", category: "personal", min_amount: 10000, max_amount: 5000000, min_tenure: 6, max_tenure: 60, interest_type: "reducing", interest_rate: 16, processing_fee_pct: 2, status: "active" });

  const load = () => {
    api("/admin/users").then(setUsers);
    api("/admin/products").then(setProducts);
    api("/admin/workflow").then((w) => { setWorkflow(w); setWfBuilder(w.filter((s: any) => s.active && !s.product_id)); });
    api("/admin/health").then(setHealth);
    api("/admin/audit?limit=20").then(setAudit);
  };
  useEffect(load, []);
  useEffect(() => { if (tab === "audit") api("/admin/audit?limit=30").then(setAudit); }, [tab]);

  const userCols: Column<any>[] = [
    { key: "name", header: "User", sortValue: (r) => r.name, render: (r) => (
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center text-[10.5px] font-semibold">{r.name.split(" ").map((n: string) => n[0]).slice(0, 2).join("")}</div>
        <div>
          <div className="font-medium text-zinc-800">{r.name}</div>
          <div className="text-[10.5px] text-zinc-400">{r.email}</div>
        </div>
      </div>
    )},
    { key: "role", header: "Role", render: (r) => <Badge status="indigo">{ROLE_LABELS_L[r.role] || r.role}</Badge> },
    { key: "branch", header: "Branch", render: (r) => <span className="text-zinc-600">{r.branch_name || "HQ"}</span> },
    { key: "last_login", header: "Last login", render: (r) => <span className="text-zinc-500">{r.last_login_at ? fmtDate(r.last_login_at) : "never"}</span> },
    { key: "active", header: "Status", render: (r) => <Badge status={r.active ? "verified" : "rejected"}>{r.active ? "active" : "disabled"}</Badge> },
    { key: "toggle", header: "", render: (r) => (
      <button className="btn btn-secondary btn-sm" onClick={async (e) => { e.stopPropagation(); await api(`/admin/users/${r.id}`, { method: "PATCH", body: { active: r.active ? false : true } }); load(); }}>
        {r.active ? "Disable" : "Enable"}
      </button>
    )}
  ];

  const productCols: Column<any>[] = [
    { key: "code", header: "Code", render: (r) => <span className="font-mono text-[11.5px] font-semibold">{r.code}</span> },
    { key: "name", header: "Product", render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-[10.5px] text-zinc-400 capitalize">{r.category}</div></div> },
    { key: "amount", header: "Amount range", render: (r) => <span className="num text-zinc-600">₹{r.min_amount.toLocaleString("en-IN")} – {r.max_amount >= 10000000 ? "₹" + (r.max_amount / 10000000).toFixed(1) + " Cr" : "₹" + (r.max_amount / 100000).toFixed(0) + " L"}</span> },
    { key: "tenure", header: "Tenure", render: (r) => <span className="num">{r.min_tenure}–{r.max_tenure} mo</span> },
    { key: "rate", header: "Rate", align: "right", render: (r) => <span className="num font-semibold">{r.interest_rate}%</span> },
    { key: "fee", header: "Fee", align: "right", render: (r) => <span className="num">{r.processing_fee_pct}%</span> },
    { key: "alloc", header: "Allocation", render: (r) => <span className="text-[10.5px] font-mono text-zinc-500">{r.allocation_order}</span> },
    { key: "status", header: "Status", render: (r) => <Badge status={r.status} /> }
  ];

  const workflowCols: Column<any>[] = [
    { key: "seq", header: "#", render: (r) => <span className="num text-zinc-400">{r.seq}</span> },
    { key: "name", header: "Stage", render: (r) => <div><div className="font-medium capitalize">{r.name}</div><div className="text-[10px] font-mono text-zinc-400">{r.code}</div></div> },
    { key: "docs", header: "Required documents", render: (r) => {
      const docs = JSON.parse(r.required_documents || "[]");
      return docs.length ? docs.map((d: string) => <Badge key={d} status="zinc">{d}</Badge>) : <span className="text-zinc-300">—</span>;
    }},
    { key: "sla", header: "SLA (hrs)", align: "right", render: (r) => <span className="num">{r.sla_hours}</span> },
    { key: "active", header: "Status", render: (r) => <Badge status={r.active ? "verified" : "rejected"}>{r.active ? "active" : "disabled"}</Badge> }
  ];

  return (
    <div>
      <PageHeader title="Administration" sub="Users · roles · products · policies · workflow · system health" breadcrumb="Platform / Admin" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <Card className="p-3"><div className="text-[10.5px] uppercase text-zinc-400 font-medium">Users</div><div className="text-[20px] font-semibold num mt-1">{users.rows?.length}</div></Card>
        <Card className="p-3"><div className="text-[10.5px] uppercase text-zinc-400 font-medium">Roles</div><div className="text-[20px] font-semibold num mt-1">{Object.keys(users.roles || {}).length}</div></Card>
        <Card className="p-3"><div className="text-[10.5px] uppercase text-zinc-400 font-medium">Products</div><div className="text-[20px] font-semibold num mt-1">{products.length}</div></Card>
        <Card className="p-3"><div className="text-[10.5px] uppercase text-zinc-400 font-medium">Workflow stages</div><div className="text-[20px] font-semibold num mt-1">{workflow.length}</div></Card>
        <Card className="p-3"><div className="text-[10.5px] uppercase text-zinc-400 font-medium">Audit events</div><div className="text-[20px] font-semibold num mt-1">{health?.counts?.audit_logs ?? audit.total}</div></Card>
      </div>

      <Tabs active={tab} onChange={setTab} items={[
        { key: "users", label: "Users & roles", count: users.rows?.length },
        { key: "products", label: "Products", count: products.length },
        { key: "workflow", label: "Workflow", count: workflow.length },
        { key: "audit", label: "Audit", count: audit.total }
      ]} />

      {tab === "users" && (
        <Card>
          <CardTitle title="Platform users" sub="Granular RBAC across 17 roles — permissions enforced server-side" right={
            <button className="btn btn-primary btn-sm" onClick={() => setUserOpen(true)}>Add user</button>
          } />
          <DataTable columns={userCols} rows={users.rows || []} total={users.rows?.length} searchable searchPlaceholder="Search users…" exportName="sniper-users" />
        </Card>
      )}

      {tab === "products" && (
        <Card>
          <CardTitle title="Product engine" sub="Every product fully configurable — rates, fees, tenure, allocation policy" right={
            <button className="btn btn-primary btn-sm" onClick={() => setProductOpen(true)}>New product</button>
          } />
          <DataTable columns={productCols} rows={products} total={products.length} searchable searchPlaceholder="Search products…" exportName="sniper-products" />
        </Card>
      )}

      {tab === "workflow" && (
        <Card>
          <CardTitle
            title="Workflow builder"
            sub="Reorder stages, set SLA hours and required documents — saving creates a new version; history is preserved, never overwritten"
            right={
              <div className="flex items-center gap-2">
                <button className="btn btn-secondary btn-sm" onClick={() => setWfBuilder((b) => [...b, { code: `stage_${b.length + 1}`, name: "New stage", sla_hours: 24, required_documents: [] }])}>Add stage</button>
                <button className="btn btn-primary btn-sm" onClick={async () => {
                  const stages = wfBuilder.map((s, i) => ({ code: s.code, name: s.name, sla_hours: Number(s.sla_hours) || 24, required_documents: [], required_fields: [] }));
                  try {
                    await api("/admin/workflow/save", { method: "POST", body: { product_id: null, stages } });
                    setWfMsg(`Workflow saved — ${stages.length} stages, previous version archived`);
                    load();
                  } catch (e: any) { setWfMsg(`Error: ${e.message}`); }
                  setTimeout(() => setWfMsg(""), 4000);
                }}>Save workflow</button>
              </div>
            }
          />
          {wfMsg && <div className="mb-3 rounded-md bg-emerald-50 border border-emerald-100 px-3 py-2 text-[11.5px] text-emerald-800">{wfMsg}</div>}
          <div className="space-y-2">
            {wfBuilder.map((s, i) => (
              <div key={s.id ?? `wf-${i}`} className="flex items-center gap-2 rounded-md border border-zinc-100 px-3 py-2">
                <div className="flex flex-col">
                  <button className="text-zinc-400 hover:text-zinc-700 cursor-pointer disabled:opacity-30" disabled={i === 0} onClick={() => setWfBuilder((b) => { const n = [...b]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>▲</button>
                  <button className="text-zinc-400 hover:text-zinc-700 cursor-pointer disabled:opacity-30" disabled={i === wfBuilder.length - 1} onClick={() => setWfBuilder((b) => { const n = [...b]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })}>▼</button>
                </div>
                <span className="num text-[12px] text-zinc-400 w-5">{i + 1}</span>
                <span className="font-mono text-[10.5px] text-zinc-400 w-28 truncate">{s.code}</span>
                <input className="input flex-1" value={s.name} onChange={(e) => setWfBuilder((b) => b.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x))} />
                <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 shrink-0">
                  SLA
                  <input className="input w-16 text-right num" type="number" min="1" value={s.sla_hours} onChange={(e) => setWfBuilder((b) => b.map((x, xi) => xi === i ? { ...x, sla_hours: Number(e.target.value) } : x))} />
                  h
                </label>
                <button className="text-zinc-300 hover:text-rose-600 cursor-pointer shrink-0" onClick={() => setWfBuilder((b) => b.filter((_, xi) => xi !== i))} title="Remove stage">✕</button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-[10.5px] text-zinc-400">
            <span>Total stages: {workflow.length}</span>
            <span>· versions preserved (old stages archived, never deleted)</span>
          </div>
        </Card>
      )}

      {tab === "audit" && (
        <Card>
          <CardTitle title="Latest audit events" sub="Append-only log — full view in Audit Trail" />
          <div className="divide-y divide-zinc-50">
            {audit.rows?.map((a: any) => (
              <div key={a.id} className="flex items-center gap-3 py-2">
                <span className="num text-[11px] text-zinc-400 w-14">{a.id}</span>
                <Badge status="indigo">{a.action.replace(/_/g, " ")}</Badge>
                <span className="text-[11.5px] text-zinc-600 flex-1 truncate">{a.entity_type} {a.entity_id ? `#${a.entity_id}` : ""}</span>
                <span className="text-[11px] text-zinc-400">{a.by_name || "system"}</span>
                <span className="text-[10.5px] text-zinc-400 w-24 text-right">{fmtDate(a.created_at)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Add user */}
      <Modal open={userOpen} onClose={() => setUserOpen(false)} title="Add platform user">
        <div className="space-y-3">
          <Field label="Full name"><input className="input" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} /></Field>
          <Field label="Role">
            <select className="input" value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
              {Object.entries(ROLE_LABELS_L).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Initial password"><input className="input" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-secondary" onClick={() => setUserOpen(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={!userForm.name || !userForm.email} onClick={async () => { await api("/admin/users", { method: "POST", body: userForm }); setUserOpen(false); load(); }}>Create user</button>
        </div>
      </Modal>

      {/* Add product */}
      <Modal open={productOpen} onClose={() => setProductOpen(false)} title="Configure loan product" wide>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="Code"><input className="input" value={productForm.code} onChange={(e) => setProductForm({ ...productForm, code: e.target.value })} /></Field>
          <Field label="Name"><input className="input" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} /></Field>
          <Field label="Category">
            <select className="input" value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}>
              {["personal", "business", "msme", "lap", "home", "vehicle", "gold", "working_capital", "invoice", "microfinance", "custom"].map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
            </select>
          </Field>
          <Field label="Min amount"><input className="input num" type="number" value={productForm.min_amount} onChange={(e) => setProductForm({ ...productForm, min_amount: Number(e.target.value) })} /></Field>
          <Field label="Max amount"><input className="input num" type="number" value={productForm.max_amount} onChange={(e) => setProductForm({ ...productForm, max_amount: Number(e.target.value) })} /></Field>
          <Field label="Interest rate %"><input className="input num" type="number" step="0.1" value={productForm.interest_rate} onChange={(e) => setProductForm({ ...productForm, interest_rate: Number(e.target.value) })} /></Field>
          <Field label="Min tenure"><input className="input num" type="number" value={productForm.min_tenure} onChange={(e) => setProductForm({ ...productForm, min_tenure: Number(e.target.value) })} /></Field>
          <Field label="Max tenure"><input className="input num" type="number" value={productForm.max_tenure} onChange={(e) => setProductForm({ ...productForm, max_tenure: Number(e.target.value) })} /></Field>
          <Field label="Processing fee %"><input className="input num" type="number" step="0.1" value={productForm.processing_fee_pct} onChange={(e) => setProductForm({ ...productForm, processing_fee_pct: Number(e.target.value) })} /></Field>
          <Field label="Interest type">
            <select className="input" value={productForm.interest_type} onChange={(e) => setProductForm({ ...productForm, interest_type: e.target.value })}>
              <option value="reducing">Reducing balance</option><option value="flat">Flat</option>
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-secondary" onClick={() => setProductOpen(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={!productForm.code || !productForm.name} onClick={async () => { await api("/admin/products", { method: "POST", body: productForm }); setProductOpen(false); load(); }}>Create product</button>
        </div>
      </Modal>
    </div>
  );
}
