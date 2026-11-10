/** Text normalisation shared by the parser and fuzzy matchers. */

const DEVANAGARI_DIGITS: Record<string, string> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

/** Lowercase, unify digits, split glued units ("2kg" → "2 kg"), drop punctuation. */
export function normalize(input: string): string {
  let s = input.normalize('NFKC').toLowerCase().trim();
  s = s.replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d] ?? d);
  s = s.replace(/₹/g, ' rupaye ');
  s = s.replace(/[!?;:"'()[\]{}|/\\]/g, ' ');
  s = s.replace(/,/g, ' ');
  // Keep decimal points, drop everything else that is punctuation.
  s = s.replace(/\.(?!\d)/g, ' ');
  s = s.replace(/(\d)([^\d\s.])/g, '$1 $2');
  s = s.replace(/([^\d\s.])(\d)/g, '$1 $2');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function tokens(input: string): string[] {
  return normalize(input)
    .split(' ')
    .map((t) => t.replace(/^[.]|[.]$/g, ''))
    .filter(Boolean);
}

/**
 * Collapse spelling variants that ASR keeps producing. Both sides of a
 * comparison run through this, so "chawal"/"chaval" and "cheeni"/"chini" agree.
 */
export function phoneticKey(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/ph/g, 'f')
    .replace(/chh/g, 'ch')
    .replace(/sh/g, 's')
    .replace(/zh/g, 'j')
    .replace(/aa/g, 'a')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/[wv]/g, 'v')
    .replace(/z/g, 'j')
    .replace(/(.)\1+/g, '$1')
    .replace(/y$/g, 'i');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

/** 0..1 similarity, tolerant of the one-or-two syllable slips we hear daily. */
export function similarity(a: string, b: string): number {
  // phoneticKey only keeps Latin characters, so exact Devanagari matches
  // (for example a Hindi ASR transcript) must be checked before it.
  const normalizedA = normalize(a);
  const normalizedB = normalize(b);
  if (normalizedA && normalizedA === normalizedB) return 1;
  const ka = phoneticKey(a);
  const kb = phoneticKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const distance = levenshtein(ka, kb);
  const longest = Math.max(ka.length, kb.length);
  const score = 1 - distance / longest;
  if (longest >= 4 && distance <= 2) return Math.max(score, 0.8);
  return score;
}

const NUMERIC_DEVANAGARI = /[०-९]/;

export function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text) || NUMERIC_DEVANAGARI.test(text);
}

/** Indian money formatting: 1240 → "₹1,240". */
export function rupees(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const [whole, fraction] = String(rounded).split('.');
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
  return `₹${grouped}${fraction ? `.${fraction}` : ''}`;
}

export function formatQty(value: number, unit: string): string {
  const clean = Math.round(value * 1000) / 1000;
  return `${clean} ${unit}`;
}
