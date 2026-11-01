// Fixes project names Whisper mishears ("Tatbifit", "TatBuffet" -> "tatvafit").
// Whisper has no reliable hint mechanism in transformers.js, so we correct afterwards:
// one to three spoken words are joined, normalised for common accent/spelling
// confusions, and compared with the vocabulary by edit distance.

/** Folds sounds that speech recognition (and accents) commonly swap. */
function phonetic(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/ph/g, 'f')
    .replace(/[bw]/g, 'v')
    .replace(/ck/g, 'k')
    .replace(/(.)\1+/g, '$1');
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/** Short words that should never be glued into a project name. */
const FILLER = new Set('a an and are as at be but by do for from go he i if in is it its me my no of on or our so that the then this to up us was we were what when with you'.split(' '));

interface Term {
  canonical: string;
  key: string;
}

export function correctVocabulary(text: string, vocabulary: string[]): string {
  const terms: Term[] = [...new Set(vocabulary)]
    .map((canonical) => ({ canonical, key: phonetic(canonical) }))
    .filter((t) => t.key.length >= 5);
  if (!terms.length) return text;

  const words = text.split(/(\s+)/); // keep whitespace tokens so spacing survives
  const idx = words.map((w, i) => (/\S/.test(w) ? i : -1)).filter((i) => i >= 0);
  const out = [...words];

  for (let p = 0; p < idx.length; p++) {
    let best: { n: number; term: Term; score: number; exact: boolean } | null = null;
    for (let n = 3; n >= 1; n--) {
      if (p + n > idx.length) continue;
      const span = idx.slice(p, p + n).map((i) => words[i]);
      const raw = span.join('');
      const key = phonetic(raw);
      if (key.length < 5) continue;
      for (const term of terms) {
        if (raw.replace(/[^a-z0-9]/gi, '').toLowerCase() === term.canonical.replace(/[^a-z0-9]/gi, '').toLowerCase()) {
          best = { n, term, score: 0, exact: true };
          break;
        }
        // Fuzzy matches across several words are risky: no filler words, near-equal length, stricter threshold.
        if (n > 1 && (span.some((w) => FILLER.has(w.toLowerCase().replace(/[^a-z]/g, ''))) || Math.abs(key.length - term.key.length) > 1)) continue;
        const d = levenshtein(key, term.key);
        const ratio = d / Math.max(key.length, term.key.length);
        // Inflections differ at the end (athlete/athletic): mishearings differ in the middle.
        const sharesStem = commonPrefix(key, term.key) / Math.min(key.length, term.key.length) >= 0.8;
        // A perfect phonetic match ("Tatwafit" ~ "tatvafit") is still a correction, not an exact spelling.
        if (ratio <= (n > 1 ? 0.2 : 0.25) && (!sharesStem || d === 0) && (!best || ratio < best.score)) best = { n, term, score: ratio, exact: false };
      }
      if (best) break;
    }
    // Replace fuzzy matches, and exact matches that were split across words ("dev cockpit").
    if (best && (!best.exact || best.n > 1)) {
      const span = idx.slice(p, p + best.n);
      const trailing = words[span[span.length - 1]].match(/[.,!?;:]+$/)?.[0] ?? '';
      out[span[0]] = best.term.canonical + trailing;
      for (let s = 1; s < span.length; s++) {
        out[span[s]] = '';
        out[span[s] - 1] = ''; // the whitespace before the merged word
      }
      p += best.n - 1;
    }
  }
  return out.join('').replace(/ {2,}/g, ' ');
}
