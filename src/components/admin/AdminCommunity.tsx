"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AdminAction, QueueItem } from "@/lib/community/db";

// What Mama has to look at: posts and comments under review, hidden ones, and anything reported.
export function AdminCommunity() {
  const [rows, setRows] = useState<QueueItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/community", { cache: "no-store" });
    if (!res.ok) return setError(`HTTP ${res.status}`);
    setRows(((await res.json()) as { queue: QueueItem[] }).queue);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function act(item: QueueItem, action: AdminAction) {
    setBusy(item.id + action);
    const res = await fetch("/api/admin/community", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: item.kind, id: item.id, action }) });
    if (!res.ok) setError(`HTTP ${res.status}`);
    await load();
    setBusy(null);
  }

  return (
    <section className="mx-auto grid w-full max-w-5xl gap-4" data-testid="admin-community">
      <header className="grid gap-1">
        <h2 className="font-display text-[30px] leading-tight">The table: what needs a look</h2>
        <p className="text-[17px] text-muted">{rows ? `${rows.length} item${rows.length === 1 ? "" : "s"}` : "Loading…"}{error ? ` · ${error}` : ""}</p>
      </header>
      {rows && rows.length === 0 && <p className="text-[17px] text-muted" data-testid="admin-community-empty">Nothing waiting. The table’s behaving.</p>}
      <ul className="grid gap-3">
        {rows?.map((r) => (
          <li key={r.kind + r.id} className="grid gap-2 rounded-[18px] border border-line bg-white p-4" data-testid="queue-item" data-queue-id={r.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-[15px] text-muted">
              <span>
                <span className="font-semibold text-ink">{r.author.name}</span> · {r.kind} · {r.state}
                {r.author.status !== "ok" ? ` · member ${r.author.status}` : ""}
              </span>
              <span>{new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            </div>
            <div className="flex gap-3">
              {r.photoId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/community/photo/${r.photoId}`} alt="" width={64} height={64} loading="lazy" className="h-16 w-16 shrink-0 rounded-[12px] object-cover" data-testid="queue-photo" />
              )}
              <p className="min-w-0 whitespace-pre-line text-[17px] text-ink">{r.text}</p>
            </div>
            <p className="text-[14px] text-muted">
              {r.modReason ? `Mama: ${r.modReason}` : ""}
              {r.openReports ? ` · ${r.openReports} report${r.openReports === 1 ? "" : "s"}: ${r.reasons.join("; ")}` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              {r.state !== "visible" && <Button size="md" variant="secondary" disabled={busy !== null} onClick={() => void act(r, "show")} data-testid="act-show">Show it</Button>}
              {r.state !== "hidden" && <Button size="md" variant="ghost" disabled={busy !== null} onClick={() => void act(r, "hide")} data-testid="act-hide">Hide it</Button>}
              {r.author.status === "ok" && <Button size="md" variant="ghost" disabled={busy !== null} onClick={() => void act(r, "mute")} data-testid="act-mute">Mute member</Button>}
              {r.author.status !== "banned" && <Button size="md" variant="ghost" disabled={busy !== null} onClick={() => void act(r, "ban")} data-testid="act-ban">Ban member</Button>}
              {r.author.status !== "ok" && <Button size="md" variant="ghost" disabled={busy !== null} onClick={() => void act(r, "restore_member")} data-testid="act-restore">Restore member</Button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
