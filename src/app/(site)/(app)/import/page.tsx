import { Suspense } from "react";
import { ImportFlow } from "@/components/import/ImportFlow";

export default function ImportPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-hidden="true" />}>
      <ImportFlow />
    </Suspense>
  );
}
