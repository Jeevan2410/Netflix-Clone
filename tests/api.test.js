import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog, loadDetails, searchShows } from "../src/api.js";

const json = (body, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });
const raw = (id) => ({ id, name: `S${id}`, genres: [], rating: { average: 8 }, weight: 50, image: { medium: "m", original: "o" }, summary: "<p>x</p>" });

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
}

test("loadCatalog joins two pages, slims them and caches the result", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async (url) => json(url.endsWith("page=0") ? [raw(1), raw(2)] : [raw(3)]));
  const storage = memoryStorage();
  const shows = await loadCatalog({ storage, now: 1 });
  assert.deepEqual(
    shows.map((s) => s.id),
    [1, 2, 3],
  );
  assert.equal(shows[0].summary, "x");
  await loadCatalog({ storage, now: 2 });
  assert.equal(fetchMock.mock.callCount(), 2, "second load comes from the cache");
});

test("loadCatalog fails loudly when TVmaze is down", async (t) => {
  t.mock.method(globalThis, "fetch", async () => json({}, false));
  await assert.rejects(loadCatalog({ storage: memoryStorage() }), /TVmaze answered 503/);
});

test("loadDetails asks for everything in one request", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => json({ ...raw(169), _embedded: { cast: [], seasons: [] } }));
  const { show, extra } = await loadDetails(169);
  assert.equal(show.id, 169);
  assert.deepEqual(Object.keys(extra), ["cast", "seasons"]);
  const url = fetchMock.mock.calls[0].arguments[0];
  for (const name of ["cast", "seasons", "episodes", "images"]) assert.ok(url.includes(`embed[]=${name}`), name);
});

test("searchShows encodes the query and unwraps results", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => json([{ score: 0.9, show: raw(7) }]));
  const results = await searchShows("doctor who");
  assert.equal(results[0].id, 7);
  assert.ok(fetchMock.mock.calls[0].arguments[0].endsWith("/search/shows?q=doctor%20who"));
});
