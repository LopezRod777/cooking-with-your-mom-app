import { Suspense } from "react";
import { SharedRecipe } from "@/components/community/SharedRecipe";

// A recipe shared into the table. The id comes from the URL at request time, so the page is read per request.

export default async function SharedRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-hidden="true" />}>
      <SharedRecipe id={id} />
    </Suspense>
  );
}
