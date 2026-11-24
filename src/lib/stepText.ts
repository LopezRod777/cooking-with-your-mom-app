// Clipped fragments read as barked orders ("… until tender. Drain."). A sentence of three words or fewer is joined
// to its neighbour with "then" ("… until tender, then drain."); two in a row become "then drain and serve".
const SHORT_WORDS = 3;

function lowerFirst(s: string): string {
  // Leave "USDA", "°F" and anything whose second character is not lowercase as written.
  return s.length > 1 && s[1] === s[1].toLowerCase() && s[1] !== s[1].toUpperCase() ? s[0].toLowerCase() + s.slice(1) : s;
}

function isShort(sentence: string): boolean {
  return /\.$/.test(sentence) && sentence.trim().split(/\s+/).length <= SHORT_WORDS;
}

export function flowStep(text: string): string {
  const sentences = text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) return text;
  const out: string[] = [];
  let lastWasMerge = false;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (isShort(s) && out.length > 0 && /\.$/.test(out[out.length - 1])) {
      const prev = out[out.length - 1].replace(/\.$/, "");
      const frag = lowerFirst(s.replace(/\.$/, ""));
      out[out.length - 1] = `${prev}${lastWasMerge ? " and " : ", then "}${frag}.`;
      lastWasMerge = true;
      continue;
    }
    if (isShort(s) && out.length === 0 && i + 1 < sentences.length && /\.$/.test(sentences[i + 1])) {
      const next = sentences[i + 1];
      out.push(`${s.replace(/\.$/, "")}, then ${lowerFirst(next)}`);
      i++;
      lastWasMerge = true;
      continue;
    }
    out.push(s);
    lastWasMerge = false;
  }
  return out.join(" ");
}
