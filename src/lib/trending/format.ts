// Pure: compact counts for the shelf ("128k likes · 2.1k comments").
const UNITS = [
  { div: 1e3, suffix: "k" },
  { div: 1e6, suffix: "M" },
  { div: 1e9, suffix: "B" },
] as const;

export function compactCount(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  for (let i = 0; i < UNITS.length; i++) {
    const { div, suffix } = UNITS[i];
    const scaled = v / div;
    const text = scaled < 10 ? scaled.toFixed(1) : String(Math.round(scaled));
    const rounded = text.replace(/\.0$/, "");
    // 999,950 would print "1000k": promote it to the next unit instead.
    if (Number(rounded) < 1000 || i === UNITS.length - 1) return rounded + suffix;
  }
  return String(v);
}

export function statLine(post: { likes: number; comments: number }): string {
  const likes = post.likes === 1 ? "like" : "likes";
  const comments = post.comments === 1 ? "comment" : "comments";
  return `${compactCount(post.likes)} ${likes} · ${compactCount(post.comments)} ${comments}`;
}
