import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { AlertTriangle, TrendingUp, ShieldAlert, Fingerprint } from "lucide-react";
import { api, fmtInr, fmtDate } from "../lib/api";
import { PageHeader, Card, CardTitle, Badge, Stat } from "../components/ui";
import { ImportExport } from "./gn/shared";

const GRADE_COLORS: Record<string, string> = { low: "#059669", standard: "#0284c7", medium: "#d97706", high: "#e11d48", unknown: "#a1a1aa" };

export default function Risk() {
  const nav = useNavigate();
  const [data, setData] = useState<any>(null);

  useEffect(() => { api("/risk").then(setData); }, []);
  if (!data) return null;

  const pieData = (data.riskGrades || []).map((g: any) => ({ name: g.grade, value: g.n, outstanding: g.outstanding }));
  const concentrationAlerts = (data.concentration || []).filter((c: any) => c.pct > 20);

  return (
    <div>
      <PageHeader title="Portfolio risk" sub="Concentration · early warning · fraud surveillance across the book" breadcrumb="Intelligence / Risk" actions={<div className="flex items-center gap-2"><ImportExport entity="loans" /><ImportExport entity="customers" /></div>} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Risk grades tracked" value={data.riskGrades?.length ?? 0} />
        <Stat label="Early warnings" value={data.earlyWarnings?.length ?? 0} tone="amber" icon={<TrendingUp size={16} />} />
        <Stat label="High-risk overdue" value={data.highRiskLoans?.length ?? 0} tone="red" icon={<ShieldAlert size={16} />} />
        <Stat label="Fraud-flagged" value={data.fraud?.length ?? 0} tone="red" icon={<Fingerprint size={16} />} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-5">
        <Card>
          <CardTitle title="Risk grade distribution" sub="Outstanding by grade" />
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                  {pieData.map((g: any) => <Cell key={g.name} fill={GRADE_COLORS[g.name] || "#a1a1aa"} />)}
                </Pie>
                <Tooltip formatter={(v: any, n: any) => [`${v} loans`, n]} contentStyle={{ fontSize: 11.5, borderRadius: 8, border: "1px solid #e4e4e7" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {pieData.map((g: any) => (
              <div key={g.name} className="flex items-center gap-1.5 text-[11px] text-zinc-600">
                <span className="w-2 h-2 rounded-full" style={{ background: GRADE_COLORS[g.name] }} />
                <span className="capitalize">{g.name}</span>
                <span className="num text-zinc-400">· {fmtInr(g.outstanding)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardTitle title="Concentration alerts" sub="Warning raised when a state exceeds 20% of book (configurable limit)" />
          <div className="space-y-2.5">
            {(data.concentration || []).map((c: any) => {
              const alert = c.pct > 20;
              return (
                <div key={c.state} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${alert ? "border-amber-200 bg-amber-50/50" : "border-zinc-100"}`}>
                  {alert && <AlertTriangle size={14} className="text-amber-500 shrink-0" />}
                  <span className="w-32 text-[12px] font-medium text-zinc-700">{c.state}</span>
                  <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden">
                    <div className={`h-full ${alert ? "bg-amber-500" : "bg-brand-500"}`} style={{ width: `${Math.min(100, c.pct)}%` }} />
                  </div>
                  <span className="num text-[12px] font-semibold w-24 text-right">{fmtInr(c.outstanding)}</span>
                  <span className={`num text-[11.5px] font-bold w-12 text-right ${alert ? "text-amber-600" : "text-zinc-400"}`}>{c.pct?.toFixed(1)}%</span>
                  {alert && <Badge status="medium">ALERT</Badge>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardTitle title="Early warning system" sub="Accounts showing first signs of stress" />
          <div className="divide-y divide-zinc-50">
            {data.earlyWarnings?.map((w: any) => (
              <div key={w.id} className="flex items-center justify-between py-2.5 cursor-pointer hover:bg-zinc-50" onClick={() => nav(`/loans/${w.id}`)}>
                <div>
                  <div className="text-[12.5px] font-medium text-zinc-800">{w.customer}</div>
                  <div className="text-[10.5px] text-zinc-400">{w.loan_no} · {w.signal}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="num text-[12px] font-semibold">{fmtInr(w.outstanding)}</span>
                  <Badge status="medium">DPD {w.dpd}</Badge>
                </div>
              </div>
            ))}
            {!data.earlyWarnings?.length && <div className="text-[12px] text-zinc-400 py-6 text-center">No early warnings at present.</div>}
          </div>
        </Card>
        <Card>
          <CardTitle title="High-risk overdue accounts" sub="Medium/high grade with active delinquency" />
          <div className="divide-y divide-zinc-50">
            {data.highRiskLoans?.map((l: any) => (
              <div key={l.id} className="flex items-center justify-between py-2.5 cursor-pointer hover:bg-zinc-50" onClick={() => nav(`/loans/${l.id}`)}>
                <div>
                  <div className="text-[12.5px] font-medium text-zinc-800">{l.customer}</div>
                  <div className="text-[10.5px] text-zinc-400">{l.loan_no}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="num text-[12px] font-semibold">{fmtInr(l.outstanding)}</span>
                  <Badge status={l.risk_grade} />
                  <Badge status={l.dpd >= 4 ? "critical" : "high"}>{l.dpd} DPD</Badge>
                </div>
              </div>
            ))}
            {!data.highRiskLoans?.length && <div className="text-[12px] text-zinc-400 py-6 text-center">No high-risk overdue accounts.</div>}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle title="Fraud surveillance" sub="Applications flagged by the SNIPER fraud engine" />
        <div className="divide-y divide-zinc-50">
          {data.fraud?.map((f: any) => (
            <div key={f.id} className="flex items-center justify-between py-2.5 cursor-pointer hover:bg-zinc-50" onClick={() => nav(`/applications/${f.id}`)}>
              <div>
                <div className="text-[12.5px] font-medium text-zinc-800">{f.customer}</div>
                <div className="text-[10.5px] text-zinc-400">{f.application_no} · {fmtDate(f.created_at)}</div>
              </div>
              <Badge status={f.fraud_score >= 60 ? "critical" : "high"}>{f.fraud_score} fraud score</Badge>
            </div>
          ))}
          {!data.fraud?.length && <div className="text-[12px] text-zinc-400 py-6 text-center">No fraud flags raised.</div>}
        </div>
      </Card>
    </div>
  );
}
