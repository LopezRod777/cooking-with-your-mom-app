import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminMembers } from "@/components/admin/AdminMembers";
import { AdminCommunity } from "@/components/admin/AdminCommunity";
import { requireAdmin, signupMode } from "@/lib/auth/requireUser";

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminGate />
    </Suspense>
  );
}

async function AdminGate() {
  await connection();
  const admin = await requireAdmin();
  if (admin instanceof Response) notFound();
  return (
    <div className="grid gap-14">
      <AdminMembers mode={signupMode()} adminEmail={admin.email} />
      <AdminCommunity />
    </div>
  );
}
