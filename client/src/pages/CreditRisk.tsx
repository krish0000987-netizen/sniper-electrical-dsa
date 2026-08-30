import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtInr, fmtDate } from "../lib/api";
import { PageHeader, Card, CardTitle, Badge, DataTable, type Column, Stat } from "../components/ui";
import { ImportExport } from "./gn/shared";

export default function CreditRisk() {
  const nav = useNavigate();
  const [risk, setRisk] = useState<any>(null);
  const [apps, setApps] = useState<any>({ rows: [] });

  useEffect(() => {
    api("/risk").then(setRisk);
    api("/applications?limit=50").then(setApps);
  }, []);

  const creditApps = (apps.rows || []).filter((r: any) => ["credit", "banking", "gst", "bre", "underwriting"].includes(r.stage) || r.fraud_score);

  const columns: Column<any>[] = [
    { key: "app", header: "Application", render: (r) => <span className="font-medium">{r.application_no}</span> },
    { key: "customer", header: "Customer", render: (r) => <span>{r.customer_name}</span> },
    { key: "amount", header: "Amount", align: "right", render: (r) => <span className="num">{fmtInr(r.requested_amount)}</span> },
    { key: "score", header: "Credit score", align: "right", render: (r) => r.credit_score ? (
      <span className={`num font-semibold ${r.credit_score >= 750 ? "text-emerald-600" : r.credit_score >= 650 ? "text-amber-600" : "text-rose-600"}`}>{r.credit_score}</span>
    ) : <span className="text-zinc-300">—</span>},
    { key: "bre", header: "BRE", render: (r) => <Badge status={r.bre_result} /> },
    { key: "risk", header: "Risk", render: (r) => <Badge status={r.risk_grade} /> },
    { key: "stage", header: "Stage", render: (r) => <Badge status={r.stage} /> }
  ];

  return (
    <div>
      <PageHeader title="Credit & risk" sub="Bureau insight, early warning signals and fraud surveillance" breadcrumb="Credit" actions={<div className="flex items-center gap-2"><ImportExport entity="loans" /><ImportExport entity="customers" /></div>} />

      {risk && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Stat label="Early warnings" value={risk.earlyWarnings?.length ?? 0} tone="red" />
            <Stat label="High-risk loans" value={risk.highRiskLoans?.length ?? 0} tone="amber" />
            <Stat label="Fraud-flagged apps" value={risk.fraud?.length ?? 0} tone="red" />
            <Stat label="States concentrated" value={risk.concentration?.length ?? 0} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-5">
            <Card>
              <CardTitle title="Concentration by state" sub="Outstanding exposure share" />
              <div className="space-y-2">
                {risk.concentration?.map((c: any) => (
                  <div key={c.state} className="flex items-center gap-3">
                    <span className="w-28 text-[11.5px] text-zinc-600 truncate">{c.state}</span>
                    <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-brand-500 to-violet-500" style={{ width: `${Math.min(100, c.pct)}%` }} />
                    </div>
                    <span className="num text-[11.5px] font-semibold w-16 text-right">{fmtInr(c.outstanding)}</span>
                    <span className="num text-[10.5px] text-zinc-400 w-10 text-right">{c.pct?.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <CardTitle title="Portfolio risk grades" />
              <div className="grid grid-cols-2 gap-3">
                {risk.riskGrades?.map((g: any) => (
                  <div key={g.grade} className="rounded-lg border border-zinc-100 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11.5px] capitalize text-zinc-500">{g.grade}</span>
                      <Badge status={g.grade} />
                    </div>
                    <div className="num text-[18px] font-semibold mt-1">{g.n}</div>
                    <div className="text-[10.5px] text-zinc-400">{fmtInr(g.outstanding)} outstanding</div>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">Early warning signals</div>
                <div className="space-y-1.5">
                  {risk.earlyWarnings?.map((w: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-[11.5px] rounded border border-amber-100 bg-amber-50/60 px-3 py-2">
                      <span className="font-medium text-amber-800">{w.customer}</span>
                      <span className="text-amber-600">{w.loan_no} · DPD {w.dpd}</span>
                    </div>
                  ))}
                  {!risk.earlyWarnings?.length && <div className="text-[11.5px] text-zinc-400">No early warnings at DPD 1-30.</div>}
                </div>
              </div>
            </Card>
          </div>

          <Card className="mb-4">
            <CardTitle title="Fraud surveillance" sub="Applications flagged by the SNIPER fraud engine" />
            {risk.fraud?.length ? (
              <div className="divide-y divide-zinc-50">
                {risk.fraud.map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between py-2.5 cursor-pointer hover:bg-zinc-50" onClick={() => nav(`/applications/${f.id}`)}>
                    <div>
                      <div className="text-[12.5px] font-medium text-zinc-800">{f.customer}</div>
                      <div className="text-[10.5px] text-zinc-400">{f.application_no} · {fmtDate(f.created_at)}</div>
                    </div>
                    <Badge status={f.fraud_score >= 60 ? "critical" : "high"}>{f.fraud_score} fraud score</Badge>
                  </div>
                ))}
              </div>
            ) : <div className="text-[12px] text-zinc-400 py-4">No fraud flags raised on recent applications.</div>}
          </Card>
        </>
      )}

      <Card>
        <CardTitle title="Applications in credit journey" />
        <DataTable columns={columns} rows={creditApps} total={creditApps.length} onRowClick={(r) => nav(`/applications/${r.id}`)} />
      </Card>
    </div>
  );
}
