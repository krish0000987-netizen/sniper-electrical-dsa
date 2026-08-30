import { useEffect, useState } from "react";
import { api, fmtDateTime } from "../lib/api";
import { PageHeader, Card, Badge, DataTable, type Column } from "../components/ui";
import { ImportExport } from "./gn/shared";

export default function AuditLog() {
  const [data, setData] = useState<any>({ rows: [], total: 0 });
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("page", String(page));
    api(`/admin/audit?${params}`).then(setData);
  }, [q, page]);

  const columns: Column<any>[] = [
    { key: "id", header: "#", render: (r) => <span className="num text-zinc-400">{r.id}</span> },
    { key: "when", header: "When", render: (r) => <span className="text-zinc-500">{fmtDateTime(r.created_at)}</span> },
    { key: "who", header: "Who", render: (r) => <span className="font-medium text-zinc-700">{r.by_name || "System"}</span> },
    { key: "action", header: "Action", render: (r) => <Badge status="indigo">{r.action.replace(/_/g, " ")}</Badge> },
    { key: "entity", header: "Entity", render: (r) => <span className="text-zinc-600">{r.entity_type} {r.entity_id ? `#${r.entity_id}` : ""}</span> },
    { key: "after", header: "Detail", render: (r) => (
      <span className="text-[11px] text-zinc-500 block max-w-[280px] truncate font-mono">{r.after ? String(r.after).slice(0, 100) : r.before ? String(r.before).slice(0, 100) : "—"}</span>
    )}
  ];

  return (
    <div>
      <PageHeader title="Audit trail" sub={`${data.total} immutable events — who, what, when, before/after`} breadcrumb="Compliance / Audit" actions={<div className="flex items-center gap-2"><ImportExport entity="customers" /></div>} />
      <div className="mb-4 flex items-center gap-2 text-[11.5px] text-zinc-500 bg-white border border-zinc-200 rounded-lg px-3 py-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
        Append-only ledger. Audit events are never updated or deleted — every sensitive action records actor, timestamp, IP and before/after state.
      </div>
      <Card>
        <DataTable
          columns={columns}
          rows={data.rows}
          total={data.total}
          page={page}
          limit={50}
          onPage={setPage}
          searchable
          searchPlaceholder="Search actions or entities…"
          onSearch={(v) => { setQ(v); setPage(1); }}
          exportName="sniper-audit"
        />
      </Card>
    </div>
  );
}
