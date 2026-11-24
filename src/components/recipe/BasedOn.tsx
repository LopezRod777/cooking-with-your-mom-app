import type { RecipeSource } from "@/lib/schemas";

// Credit for the pages Mama read when the post did not give the full recipe. Shown wherever the recipe is.
export function BasedOn({ source, className = "" }: { source: RecipeSource | undefined; className?: string }) {
  const pages = source?.basedOn ?? [];
  if (pages.length === 0) return null;
  const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
  return (
    <p data-testid="based-on" className={`text-[16px] leading-snug text-muted ${className}`}>
      Mama filled in the gaps from{" "}
      {pages.map((p, i) => (
        <span key={p.url}>
          {i > 0 && " · "}
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline underline-offset-4">
            {p.title?.trim() || host(p.url)}
          </a>
        </span>
      ))}
      . Amounts are from the closest recipe she found.
    </p>
  );
}
