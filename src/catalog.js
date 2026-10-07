// Pure catalogue logic: shaping TVmaze data, ranking, rows and routes. No DOM, no network.

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

/** TVmaze summaries are HTML. Reduce them to plain text; the page only ever shows them with textContent. */
export function plainText(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>\s*<p[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
      if (code[0] === "#") {
        const value = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(value) ? String.fromCodePoint(value) : match;
      }
      return ENTITIES[code.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Keep only what the page uses, so the cached catalogue stays small. */
export function slim(show) {
  return {
    id: show.id,
    name: show.name,
    genres: show.genres ?? [],
    rating: show.rating?.average ?? null,
    weight: show.weight ?? 0,
    premiered: show.premiered ?? null,
    ended: show.ended ?? null,
    status: show.status ?? "",
    runtime: show.runtime ?? show.averageRuntime ?? null,
    language: show.language ?? "",
    network: show.network?.name ?? show.webChannel?.name ?? "",
    poster: show.image?.medium ?? null,
    posterLarge: show.image?.original ?? null,
    summary: plainText(show.summary),
  };
}

/** "2008–2013", "2019–" while still running, or a single year. */
export function years(show) {
  const start = show.premiered?.slice(0, 4) ?? "";
  if (!start) return "";
  if (show.status === "Running") return `${start}–`;
  const end = show.ended?.slice(0, 4);
  return end && end !== start ? `${start}–${end}` : start;
}

/** Rating nudged by TVmaze's popularity weight, so well-loved hits beat obscure perfect scores. */
export const score = (show) => (show.rating ?? 0) * (0.6 + (0.4 * show.weight) / 100);

const ranked = (shows) => shows.filter((show) => show.rating && show.poster).sort((a, b) => score(b) - score(a));

export const GENRE_ROWS = [
  ["Drama", "Gripping drama"],
  ["Science-Fiction", "Science fiction"],
  ["Crime", "Crime and detectives"],
  ["Comedy", "Comedy"],
  ["Thriller", "Edge-of-your-seat thrillers"],
  ["Fantasy", "Fantasy worlds"],
  ["Anime", "Anime"],
  ["Horror", "After dark"],
  ["Family", "For the whole family"],
];

/** The rows on the home page. Rows with too few shows are dropped. */
export function buildRows(shows, { perRow = 18 } = {}) {
  const best = ranked(shows);
  const rows = [{ id: "top", title: "Top 10 shows", items: best.slice(0, 10), top: true }];
  rows.push({ id: "acclaimed", title: "Critically acclaimed", items: best.filter((s) => s.rating >= 8.5).slice(10, 10 + perRow) });
  for (const [genre, title] of GENRE_ROWS) {
    const items = best.filter((s) => s.genres.includes(genre)).slice(0, perRow);
    rows.push({ id: genre.toLowerCase().replace(/[^a-z]+/g, "-"), title, items });
  }
  return rows.filter((row) => row.items.length >= 6);
}

/** Shows for the rotating billboard: the very best, each only once. */
export const featured = (shows, count = 5) => ranked(shows).slice(0, count);

/** The widest background image TVmaze has, preferring the one marked main. */
export function pickBackground(images = []) {
  const backgrounds = images.filter((image) => image.type === "background" && image.resolutions?.original?.url);
  const main = backgrounds.find((image) => image.main) ?? backgrounds[0];
  return main?.resolutions.original.url ?? null;
}

/** "#show/169" → { view: "show", id: 169 }; "#list" → { view: "list" }; anything else is home. */
export function parseRoute(hash) {
  const show = /^#show\/(\d+)$/.exec(hash);
  if (show) return { view: "show", id: Number(show[1]) };
  if (hash === "#list") return { view: "list" };
  return { view: "home" };
}

/** Add or remove a show id from "My List", newest first. */
export const toggleInList = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [id, ...list]);

/** Episodes grouped by season number. */
export function bySeason(episodes = []) {
  const seasons = new Map();
  for (const episode of episodes) {
    if (!seasons.has(episode.season)) seasons.set(episode.season, []);
    seasons.get(episode.season).push(episode);
  }
  return seasons;
}
