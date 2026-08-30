import { useEffect, useState } from "react";
import { Plug2, CheckCircle2, FlaskConical, XCircle, CircleDashed } from "lucide-react";
import { api } from "../lib/api";
import { PageHeader, Card, CardTitle, Badge } from "../components/ui";

const CATEGORIES = ["identity", "credit", "business", "banking", "payments", "documents", "communication"];

const STATUS_META: Record<string, { icon: any; cls: string }> = {
  connected: { icon: CheckCircle2, cls: "text-emerald-500" },
  sandbox: { icon: FlaskConical, cls: "text-amber-500" },
  error: { icon: XCircle, cls: "text-rose-500" },
  not_configured: { icon: CircleDashed, cls: "text-zinc-300" }
};

export default function Integrations() {
  const [rows, setRows] = useState<any[]>([]);
  const load = () => api("/admin/integrations").then(setRows);
  useEffect(() => { load(); }, []);

  const grouped = CATEGORIES.map((cat) => ({
    cat,
    items: rows.filter((r) => r.category === cat)
  }));

  const counts = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <div>
      <PageHeader title="Integration Hub" sub="One centralized adapter layer — every external provider replaceable" breadcrumb="Platform / Integrations" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Card className="p-3 flex items-center gap-3"><CheckCircle2 size={16} className="text-emerald-500" /><div><div className="text-[18px] font-semibold num">{counts("connected")}</div><div className="text-[10.5px] text-zinc-400 uppercase">Connected</div></div></Card>
        <Card className="p-3 flex items-center gap-3"><FlaskConical size={16} className="text-amber-500" /><div><div className="text-[18px] font-semibold num">{counts("sandbox")}</div><div className="text-[10.5px] text-zinc-400 uppercase">Sandbox / Mock</div></div></Card>
        <Card className="p-3 flex items-center gap-3"><XCircle size={16} className="text-rose-500" /><div><div className="text-[18px] font-semibold num">{counts("error")}</div><div className="text-[10.5px] text-zinc-400 uppercase">Error</div></div></Card>
        <Card className="p-3 flex items-center gap-3"><CircleDashed size={16} className="text-zinc-300" /><div><div className="text-[18px] font-semibold num">{counts("not_configured")}</div><div className="text-[10.5px] text-zinc-400 uppercase">Not configured</div></div></Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {grouped.map((g) => (
          <Card key={g.cat}>
            <CardTitle title={g.cat.charAt(0).toUpperCase() + g.cat.slice(1)} sub={`${g.items.length} adapters`} />
            <div className="space-y-2">
              {g.items.map((it) => {
                const meta = STATUS_META[it.status] || STATUS_META.not_configured;
                return (
                  <div key={it.id} className="flex items-center gap-2.5 rounded-lg border border-zinc-100 px-3 py-2">
                    <meta.icon size={15} className={meta.cls} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-zinc-800 truncate">{it.name}</div>
                      <div className="text-[10px] text-zinc-400">{it.provider || "—"}</div>
                    </div>
                    <select
                      className="input w-28 text-[10.5px] py-1"
                      value={it.status}
                      onChange={async (e) => { await api(`/admin/integrations/${it.id}`, { method: "PATCH", body: { status: e.target.value } }); load(); }}
                    >
                      <option value="connected">Connected</option>
                      <option value="sandbox">Sandbox</option>
                      <option value="error">Error</option>
                      <option value="not_configured">Not configured</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-5 flex items-start gap-2 text-[11.5px] text-zinc-500 bg-white border border-zinc-200 rounded-lg px-4 py-3">
        <Plug2 size={14} className="text-brand-500 shrink-0 mt-0.5" />
        <span>
          All providers run through the SNIPER adapter abstraction (e.g. <code className="text-[10.5px] bg-zinc-100 px-1 rounded">CreditService → CIBIL/Experian/Equifax/CRIF/MockCreditAdapter</code>).
          In this demo every integration is <Badge status="sandbox">SANDBOX</Badge> — no live provider is queried and no external credential is stored.
        </span>
      </div>
    </div>
  );
}
