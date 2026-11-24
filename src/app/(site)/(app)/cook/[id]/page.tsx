import { Suspense } from "react";
import { connection } from "next/server";
import { CookMode } from "@/components/cook/CookMode";

// The recipe lives in the browser (localStorage) and the route depends on the
// [id] in the URL, so it renders per request. instant cannot be exported from a
// Client Component, so this page stays a Server Component.
export const instant = false;

export default async function CookPage() {
  await connection();
  return (
    <Suspense fallback={null}>
      <CookMode />
    </Suspense>
  );
}
