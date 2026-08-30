import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtInr, fmtDate } from "../lib/api";
import { PageHeader, Card, DataTable, Badge, type Column } from "../components/ui";
import { ImportExport } from "./gn/shared";

const BUCKETS = [
  ["", "All"], ["0", "0 DPD"], ["1-30", "1–30"], ["31-60", "31–60"], ["61-90", "61–90"], ["90+", "90+"]
];

export default function Loans() {
  const nav = useNavigate();
  const [data, setData] = useState<any>({ rows: [], total: 0 });
  const [dpd, setDpd] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const params = new URLSearchParams();
    if (dpd) params.set("dpd", dpd);
    if (q) params.set("q", q);
    params.set("page", String(page));
    api(`/loans?${params}`).then(setData);
  }, [dpd, q, page]);

  const columns: Column<any>[] = [
    { key: "loan_no", header: "Loan account", render: (r) => (
      <div>
        <div className="font-medium text-zinc-800">{r.loan_no}</div>
        <div className="text-[10.5px] text-zinc-400">{fmtDate(r.disbursed_at)}</div>
      </div>
    )},
    { key: "customer", header: "Customer", sortValue: (r) => r.customer_name, render: (r) => (
      <div>
        <div className="font-medium text-zinc-800">{r.customer_name}</div>
        <div className="text-[10.5px] text-zinc-400">{r.mobile} · {r.city || ""}</div>
      </div>
    )},
    { key: "product", header: "Product", render: (r) => <span className="text-zinc-600">{r.product_name}</span> },
    { key: "principal", header: "Principal", align: "right", sortValue: (r) => r.principal, render: (r) => <span className="num">{fmtInr(r.principal)}</span> },
    { key: "outstanding", header: "Outstanding", align: "right", sortValue: (r) => r.outstanding, render: (r) => <span className="num font-semibold">{fmtInr(r.outstanding)}</span> },
    { key: "emi", header: "EMI", align: "right", render: (r) => <span className="num">{fmtInr(r.emi)}</span> },
    { key: "rate", header: "Rate", align: "right", render: (r) => <span className="num">{r.rate}%</span> },
    { key: "dpd", header: "DPD", align: "right", sortValue: (r) => r.dpd, render: (r) => (
      <span className={`num font-bold ${r.dpd === 0 ? "text-emerald-600" : r.dpd === 1 ? "text-amber-500" : r.dpd <= 3 ? "text-orange-600" : "text-rose-600"}`}>{r.dpd}</span>
    )},
    { key: "npa", header: "Class", render: (r) => r.npa_class ? <Badge status="critical">{r.npa_class}</Badge> : <span className="text-zinc-300">—</span> },
    { key: "risk", header: "Risk", render: (r) => <Badge status={r.risk_grade} /> },
    { key: "status", header: "Status", render: (r) => <Badge status={r.status} /> }
  ];

  return (
    <div>
      <PageHeader title="Loan accounts" sub={`${data.total} loans · full servicing lifecycle from disbursement to closure`} breadcrumb="LMS / Loans" actions={
        <div className="flex items-center gap-2"><ImportExport entity="loans" /></div>
      } />

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {BUCKETS.map(([v, label]) => (
          <button key={v} className={`btn ${dpd === v ? "btn-primary btn-sm" : "btn-secondary btn-sm"}`} onClick={() => { setDpd(v); setPage(1); }}>{label}</button>
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
          searchPlaceholder="Search by loan no, customer, mobile…"
          onSearch={(v) => { setQ(v); setPage(1); }}
          onRowClick={(r) => nav(`/loans/${r.id}`)}
          exportName="sniper-loans"
        />
      </Card>
    </div>
  );
}
