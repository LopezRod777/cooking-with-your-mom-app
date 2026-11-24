"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { MemberRow, MemberStatus } from "@/lib/auth/members";

const STATUS_LABEL: Record<MemberStatus, string> = { waiting: "Waiting", approved: "In", blocked: "Blocked" };
const STATUS_CLASS: Record<MemberStatus, string> = {
  waiting: "bg-[#ffe6a3] text-[#5a4200]",
  approved: "bg-basil-soft text-basil-text",
  blocked: "bg-[#fde7e2] text-tomato",
};

function when(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function csvOf(rows: MemberRow[]): string {
  const head = ["email", "status", "signed_up", "ref", "setup_done", "people", "has_plan", "last_seen", "user_id"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.email, r.status, r.createdAt, r.ref ?? "", r.onboarded, r.people, r.hasPlan, r.lastSeen ?? "", r.userId].map(esc).join(","));
  return [head.join(","), ...lines].join("\n");
}

export function AdminMembers({ mode, adminEmail }: { mode: string; adminEmail: string }) {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin/members", { cache: "no-store" });
    if (!res.ok) {
      setError(`Couldn’t load the list (${res.status}).`);
      return;
    }
    const json = (await res.json()) as { members: MemberRow[] };
    setRows(json.members);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(userId: string, status: MemberStatus) {
    setBusy(userId);
    const res = await fetch("/api/admin/members", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, status }) });
    setBusy(null);
    if (!res.ok) {
      setError(`Couldn’t save (${res.status}).`);
      return;
    }
    const json = (await res.json().catch(() => null)) as { welcome?: { sent: boolean; reason?: string } | null } | null;
    if (json?.welcome) setNotice(json.welcome.sent ? "Welcome email sent." : `Let in, but the welcome email did not go out (${json.welcome.reason}).`);
    await load();
  }

  async function remove(userId: string) {
    setBusy(userId);
    const res = await fetch(`/api/admin/members?userId=${encodeURIComponent(userId)}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      setError(`Couldn’t remove (${res.status}).`);
      return;
    }
    await load();
  }

  function download() {
    if (!rows) return;
    const blob = new Blob([csvOf(rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cwym-members-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const waiting = rows?.filter((r) => r.status === "waiting").length ?? 0;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6">
      <header className="grid gap-2">
        <h1 className="font-display text-[36px] leading-tight">Who’s at the door</h1>
        <p className="text-[17px] text-muted">
          Sign-up mode: <span className="font-semibold text-ink">{mode}</span> · you: {adminEmail}
          {rows && (
            <>
              {" "}
              · <span data-testid="admin-counts">{rows.length} accounts, {waiting} waiting</span>
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="ghost" size="md" onClick={() => void load()}>
            Refresh
          </Button>
          <Button variant="ghost" size="md" onClick={download} disabled={!rows?.length}>
            Download CSV
          </Button>
        </div>
      </header>
      {error && (
        <p role="status" className="text-[18px] leading-snug">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" data-testid="admin-notice" className="text-[18px] leading-snug text-muted">
          {notice}
        </p>
      )}
      {!rows ? (
        <p className="text-[18px] text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[18px] text-muted">Nobody yet.</p>
      ) : (
        <ul className="grid gap-3" data-testid="admin-members">
          {rows.map((r) => (
            <li key={r.userId} data-testid="admin-member" data-status={r.status} className="grid gap-3 rounded-2xl border border-line bg-paper p-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[18px] font-semibold">{r.email || "(invite list)"}</span>
                  <span className={`rounded-full px-3 py-0.5 text-[14px] font-semibold ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  {r.ref && <span className="rounded-full bg-panel px-3 py-0.5 text-[14px] text-muted">ref: {r.ref}</span>}
                  {r.welcomedAt && <span className="rounded-full bg-panel px-3 py-0.5 text-[14px] text-muted">welcomed</span>}
                </div>
                <p className="text-[15px] text-muted">
                  Signed up {when(r.createdAt)} · {r.onboarded ? "setup done" : "setup not finished"} · {r.people} at the table · {r.hasPlan ? "has a plan" : "no plan yet"} · last seen {when(r.lastSeen)}
                </p>
              </div>
              {r.email && (
                <div className="flex flex-wrap gap-2">
                  {r.status !== "approved" && (
                    <Button size="md" disabled={busy === r.userId} onClick={() => void decide(r.userId, "approved")}>
                      Let in
                    </Button>
                  )}
                  {r.status !== "waiting" && (
                    <Button variant="ghost" size="md" disabled={busy === r.userId} onClick={() => void decide(r.userId, "waiting")}>
                      Back to waiting
                    </Button>
                  )}
                  {r.status !== "blocked" && (
                    <Button variant="ghost" size="md" disabled={busy === r.userId} onClick={() => void decide(r.userId, "blocked")}>
                      Block
                    </Button>
                  )}
                  <Button variant="ghost" size="md" disabled={busy === r.userId} onClick={() => void remove(r.userId)}>
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
