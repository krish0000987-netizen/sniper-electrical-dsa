import { useEffect, useState } from "react";
import { Plug2, CheckCircle2, FlaskConical, XCircle, CircleDashed, Hourglass, ShieldOff, Play, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { PageHeader, Card, CardTitle } from "../components/ui";

const CATEGORIES = ["identity", "credit", "business", "banking", "payments", "documents", "communication"];
const STATUS_META: Record<string, { icon: any; cls: string; label: string }> = {
  connected: { icon: CheckCircle2, cls: "text-emerald-500", label: "Connected" },
  sandbox: { icon: FlaskConical, cls: "text-amber-500", label: "Sandbox / Mock" },
  error: { icon: XCircle, cls: "text-rose-500", label: "Error" },
  not_configured: { icon: CircleDashed, cls: "text-zinc-300", label: "Not configured" },
  awaiting_enablement: { icon: Hourglass, cls: "text-sky-500", label: "Awaiting Digitap enablement" }
};
const CARD_ORDER = ["connected", "sandbox", "awaiting_enablement", "error", "not_configured"];

interface HubRow {
  id: number;
  code: string;
  category: string;
  name: string;
  provider: string | null;
  mode: "mock" | "live";
  effectiveStatus: string;
  excluded: boolean;
  driver: string;
  digitapFamily: string | null;
  digitapProduct: string | null;
  digitapEnabled: boolean;
  credentialsConfigured: boolean;
  needsConsent: boolean;
  note: string;
}

export default function Integrations() {
  const [rows, setRows] = useState<HubRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [env, setEnv] = useState<any>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => api<any>("/admin/integrations").then((d) => { setRows(d.rows); setCounts(d.counts); setEnv(d.env); });
  useEffect(() => { load(); }, []);

  const flash = (ok: boolean, text: string) => { setToast({ ok, text }); setTimeout(() => setToast(null), 8000); };
  const setMode = async (r: HubRow, mode: "mock" | "live") => {
    try {
      const out = await api(`/admin/integrations/${r.id}`, { method: "PATCH", body: { mode } });
      await load();
      flash(true, `${r.name} → ${mode === "live" ? "Live (provider) mode. Hub status now shows what Digitap actually allows." : "Sandbox (mock) mode."}`);
      return out;
    } catch (e: any) { flash(false, e.message); }
  };
  const test = async (r: HubRow) => {
    setBusyId(r.id);
    try {
      const out = await api<{ ok: boolean; message: string; detail?: string }>(`/admin/integrations/${r.id}/test`, { method: "POST", body: {} });
      flash(out.ok, `${r.name}: ${out.message}${out.detail ? " · " + out.detail : ""}`);
      await load();
    } catch (e: any) { flash(false, `${r.name}: ${e.message}`); }
    finally { setBusyId(null); }
  };

  const grouped = CATEGORIES.map((cat) => ({ cat, items: rows.filter((r) => r.code && r.category === cat) }));
  return (
    <div>
      <PageHeader title="Integration Hub" sub="One centralized adapter layer — every external provider replaceable" breadcrumb="Platform / Integrations" />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        {CARD_ORDER.map((s) => {
          const meta = STATUS_META[s];
          return (
            <Card key={s} className="p-3 flex items-center gap-3">
              <meta.icon size={16} className={meta.cls} />
              <div>
                <div className="text-[18px] font-semibold num">{counts[s] ?? 0}</div>
                <div className="text-[10.5px] text-zinc-400 uppercase">{meta.label}</div>
              </div>
            </Card>
          );
        })}
      </div>

      {toast && (
        <div className={`mb-4 text-[12px] rounded-lg border px-3 py-2 ${toast.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {toast.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {grouped.map((g) => (
          <Card key={g.cat}>
            <CardTitle title={g.cat.charAt(0).toUpperCase() + g.cat.slice(1)} sub={`${g.items.length} adapters`} />
            <div className="space-y-2">
              {g.items.map((it) => {
                const meta = STATUS_META[it.effectiveStatus] || STATUS_META.not_configured;
                return (
                  <div key={it.id} className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${it.excluded ? "opacity-60 border-zinc-100" : "border-zinc-100"}`}>
                    {it.excluded ? <ShieldOff size={15} className="text-zinc-300" /> : <meta.icon size={15} className={meta.cls} />}
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-zinc-800 truncate">{it.name}</div>
                      <div className="text-[10px] text-zinc-400 truncate">
                        {it.excluded ? "Out of scope" : it.provider || it.digitapProduct || "—"}
                        {!it.excluded && it.effectiveStatus === "awaiting_enablement" && <span className="text-sky-500"> · {it.note || "run Test to verify"}</span>}
                        {!it.excluded && it.effectiveStatus === "connected" && <span className="text-emerald-500"> · live probe passed</span>}
                        {!it.excluded && it.effectiveStatus === "error" && <span className="text-rose-500"> · {it.note || "test failed — check credentials"}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!it.excluded && (
                        <select
                          className="input w-[86px] text-[10.5px] py-1"
                          value={it.mode}
                          disabled={busyId === it.id}
                          onChange={async (e) => { await setMode(it, e.target.value as "mock" | "live"); }}
                        >
                          <option value="mock">Sandbox</option>
                          <option value="live">Live</option>
                        </select>
                      )}
                      <button
                        className={`btn px-2 py-1 text-[10.5px] ${busyId === it.id ? "btn-secondary opacity-60" : "btn-secondary"}`}
                        disabled={it.excluded || busyId === it.id}
                        onClick={() => test(it)}
                        title="Test connection / enablement"
                      >
                        {busyId === it.id ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Test
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-5 space-y-2">
        <div className="flex items-start gap-2 text-[11.5px] text-zinc-500 bg-white border border-zinc-200 rounded-lg px-4 py-3">
          <Plug2 size={14} className="text-brand-500 shrink-0 mt-0.5" />
          <span>
            All providers run through the SNIPER adapter abstraction and are powered by <b>Digitap</b>{" "}
            (env <code className="text-[10.5px] bg-zinc-100 px-1 rounded">{env?.digitapEnv?.toUpperCase() ?? "—"}</code>, credentials{" "}
            <code className="text-[10.5px] bg-zinc-100 px-1 rounded">{env?.digitapCredentials ?? "—"}</code>).
            Statuses are computed from real driver probes — an admin cannot mark an adapter Connected without a passing test.
            Payment &amp; Communication adapters are out of scope by design.
          </span>
        </div>
        <div className="text-[11px] text-zinc-400 px-1">
          {env?.note ?? ""}
        </div>
      </div>
    </div>
  );
}
