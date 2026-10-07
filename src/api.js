// TVmaze's free public API: no key, CORS open. Data is CC BY-SA; the page credits TVmaze.

import { slim } from "./catalog.js";

const BASE = "https://api.tvmaze.com";
const CATALOG_KEY = "reelhouse:catalog";
const CACHE_MS = 6 * 60 * 60 * 1000;

async function getJson(path, signal) {
  const response = await fetch(`${BASE}${path}`, { signal });
  if (!response.ok) throw new Error(`TVmaze answered ${response.status} for ${path}`);
  return response.json();
}

/** About 500 shows from the first two index pages, slimmed and cached for the session. */
export async function loadCatalog({ storage = globalThis.sessionStorage, now = Date.now() } = {}) {
  try {
    const cached = JSON.parse(storage?.getItem(CATALOG_KEY) ?? "null");
    if (cached && now - cached.at < CACHE_MS && Array.isArray(cached.shows)) return cached.shows;
  } catch {
    // Unreadable cache: load again.
  }
  const pages = await Promise.all([getJson("/shows?page=0"), getJson("/shows?page=1")]);
  const shows = pages.flat().map(slim);
  try {
    storage?.setItem(CATALOG_KEY, JSON.stringify({ at: now, shows }));
  } catch {
    // Storage full or blocked: carry on without the cache.
  }
  return shows;
}

/** One show with cast, seasons, episodes and images, in a single request. */
export async function loadDetails(id, signal) {
  const embeds = ["cast", "seasons", "episodes", "images"].map((name) => `embed[]=${name}`).join("&");
  const show = await getJson(`/shows/${id}?${embeds}`, signal);
  return { show: slim(show), extra: show._embedded ?? {} };
}

export async function loadImages(id, signal) {
  return getJson(`/shows/${id}/images`, signal);
}

export async function searchShows(query, signal) {
  const results = await getJson(`/search/shows?q=${encodeURIComponent(query)}`, signal);
  return results.map((result) => slim(result.show));
}
