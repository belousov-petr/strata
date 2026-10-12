// Significant words of a short text such as a title, a slug or an area:
// lowercased, four letters or more, minus common words. `strata journal clear`
// uses them to find a filed entry in the working tree (ADR-0028), and
// `strata new-issue` to find possible duplicates (ADR-0031).

export const STOPWORDS = new Set([
  'about', 'after', 'again', 'also', 'been', 'before', 'being', 'both', 'cannot', 'could',
  'does', 'doing', 'done', 'down', 'each', 'even', 'every', 'from', 'have', 'having',
  'here', 'into', 'just', 'like', 'make', 'many', 'more', 'most', 'much', 'must',
  'need', 'needs', 'never', 'none', 'only', 'other', 'over', 'same', 'should', 'some',
  'such', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'through', 'under', 'until', 'upon', 'very', 'want', 'were', 'what', 'when',
  'where', 'which', 'while', 'will', 'with', 'within', 'without', 'would', 'your',
  // The journal masks secret-shaped values as <redacted>.
  'redacted',
])

const LETTERS = /\p{L}+/gu

// The distinct significant words of one or more texts, in first-seen order.
export function significantWords(...texts) {
  const out = new Set()
  for (const t of texts) {
    for (const w of String(t == null ? '' : t).normalize('NFKC').toLowerCase().match(LETTERS) || []) {
      if (w.length >= 4 && !STOPWORDS.has(w)) out.add(w)
    }
  }
  return [...out]
}

// Every distinct word of a longer text, sorted, for prefix lookups.
export function wordIndex(text) {
  const set = new Set(String(text || '').normalize('NFKC').toLowerCase().match(LETTERS) || [])
  return [...set].sort()
}

// True when some word in the index starts with `word`, so `stall` finds
// `stalls` and `stalled`. Binary search for the first word not below it.
export function hasWord(index, word) {
  let lo = 0
  let hi = index.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (index[mid] < word) lo = mid + 1
    else hi = mid
  }
  return lo < index.length && index[lo].startsWith(word)
}
