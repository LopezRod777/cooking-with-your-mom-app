// Words that never reach the table, in English and Spanish. Matched as whole words (plurals and common endings
// allowed), case- and accent-insensitive. Short on purpose: slurs, sexual terms, the worst insults. Everything
// subtler goes to the classifier (moderate.ts). Not exported as data: keep the list out of the client bundle.
const BLOCKED: readonly string[] = [
  // English slurs and hard insults
  "nigger", "nigga", "faggot", "fag", "retard", "retarded", "tranny", "kike", "spic", "chink", "wetback", "cunt",
  "whore", "slut", "bitch", "motherfucker", "fuck", "fucking", "fucker", "shit", "asshole", "dick", "cock", "pussy",
  "fck", "fuk", "fvck", "rape", "rapist", "kys", "kill yourself",
  // Spanish
  "puto", "puta", "putas", "putos", "pendejo", "pendeja", "pendejos", "pendejas", "verga", "vergas", "chinga",
  "chingada", "chingado", "chingar", "chingue", "culero", "culera", "culeros", "mierda", "mamón", "mamona",
  "joto", "jota", "jotos", "maricón", "maricon", "maricones", "marica", "zorra", "perra", "cabrón", "cabron",
  "cabrona", "cabrones", "pinche", "pinches", "coño", "polla", "gilipollas", "hijo de puta", "hija de puta",
  "mátate", "matate", "suicídate", "suicidate", "violar", "violador", "negro de mierda",
];

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Letters, digits and the usual leet swaps collapse so "f*ck" / "p3ndejo" do not slip through.
const deleet = (s: string) => s.replace(/[@4]/g, "a").replace(/[3€]/g, "e").replace(/[1!|]/g, "i").replace(/[0]/g, "o").replace(/[$5]/g, "s").replace(/[*]/g, "");

const PATTERNS = BLOCKED.map((w) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(fold(w)).replace(/ /g, "\\s+")}(?:s|es|a|o|as|os|ita|ito)?(?![\\p{L}\\p{N}])`, "u"));

// The first blocked word found, folded, or null.
export function blockedWord(text: string): string | null {
  const t = deleet(fold(text));
  for (let i = 0; i < PATTERNS.length; i++) if (PATTERNS[i].test(t)) return BLOCKED[i];
  return null;
}

// Contact and off-site details: emails, phone numbers, URLs and handles are masked, and the text goes to review.
const CONTACT_RES: RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  /(?:https?:\/\/|www\.)\S+/gi,
  /\b[\w-]+\.(?:com|net|org|io|app|mx|co|me|ly|gg)\b(?:\/\S*)?/gi,
  /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)/g,
  /(?<![\w])@[a-z0-9_.]{3,}/gi,
];

export function maskContact(text: string): { text: string; masked: boolean } {
  let masked = false;
  let out = text;
  for (const re of CONTACT_RES) {
    out = out.replace(re, () => {
      masked = true;
      return "[removed]";
    });
  }
  return { text: out, masked };
}
