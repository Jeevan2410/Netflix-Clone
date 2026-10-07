import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRows, bySeason, featured, parseRoute, pickBackground, plainText, score, slim, toggleInList, years } from "../src/catalog.js";

const show = (id, rating, genres = ["Drama"], extra = {}) => ({
  id,
  name: `Show ${id}`,
  genres,
  rating,
  weight: 100,
  premiered: "2010-01-01",
  ended: null,
  status: "Ended",
  runtime: 60,
  language: "English",
  network: "",
  poster: `p${id}.jpg`,
  posterLarge: null,
  summary: "",
  ...extra,
});

test("plainText strips tags and decodes entities", () => {
  assert.equal(plainText("<p><b>Breaking Bad</b> follows&nbsp;Walter&#39;s fall &amp; rise.</p>"), "Breaking Bad follows Walter's fall & rise.");
  assert.equal(plainText("<p>One.</p><p>Two.</p>"), "One. Two.");
  assert.equal(plainText('<img src=x onerror="alert(1)">Safe'), "Safe");
  assert.equal(plainText(null), "");
  assert.equal(plainText("&#x2014; &unknown;"), "— &unknown;");
});

test("slim keeps only the fields the page uses", () => {
  const raw = {
    id: 169,
    name: "Breaking Bad",
    genres: ["Drama", "Crime"],
    rating: { average: 9.2 },
    weight: 99,
    premiered: "2008-01-20",
    ended: "2013-09-29",
    status: "Ended",
    runtime: null,
    averageRuntime: 47,
    language: "English",
    network: { name: "AMC" },
    image: { medium: "m.jpg", original: "o.jpg" },
    summary: "<p>Hi</p>",
    externals: { imdb: "tt0903747" },
  };
  assert.deepEqual(slim(raw), {
    id: 169,
    name: "Breaking Bad",
    genres: ["Drama", "Crime"],
    rating: 9.2,
    weight: 99,
    premiered: "2008-01-20",
    ended: "2013-09-29",
    status: "Ended",
    runtime: 47,
    language: "English",
    network: "AMC",
    poster: "m.jpg",
    posterLarge: "o.jpg",
    summary: "Hi",
  });
  assert.equal(slim({ id: 1, name: "x", webChannel: { name: "Netflix" } }).network, "Netflix");
});

test("years shows a range, an open range, or one year", () => {
  assert.equal(years({ premiered: "2008-01-20", ended: "2013-09-29", status: "Ended" }), "2008–2013");
  assert.equal(years({ premiered: "2019-04-01", ended: null, status: "Running" }), "2019–");
  assert.equal(years({ premiered: "2015-01-01", ended: "2015-06-01", status: "Ended" }), "2015");
  assert.equal(years({ premiered: null }), "");
});

test("score favours popular shows at the same rating", () => {
  assert.ok(score({ rating: 9, weight: 100 }) > score({ rating: 9, weight: 20 }));
  assert.equal(score({ rating: null, weight: 100 }), 0);
});

test("buildRows makes a top 10, genre rows, and drops thin rows", () => {
  const shows = [
    ...Array.from({ length: 12 }, (_, i) => show(i + 1, 9 - i * 0.1, ["Drama"])),
    ...Array.from({ length: 3 }, (_, i) => show(100 + i, 7, ["Horror"])),
    show(200, null),
    show(201, 9.9, ["Drama"], { poster: null }),
  ];
  const rows = buildRows(shows);
  const top = rows.find((row) => row.id === "top");
  assert.equal(top.items.length, 10);
  assert.equal(top.items[0].id, 1, "best score first; unrated and posterless shows are left out");
  assert.ok(rows.some((row) => row.id === "drama"));
  assert.ok(!rows.some((row) => row.id === "horror"), "a row with only 3 shows is dropped");
  assert.deepEqual(
    featured(shows, 3).map((s) => s.id),
    [1, 2, 3],
  );
});

test("pickBackground prefers the main background image", () => {
  const image = (type, main, url) => ({ type, main, resolutions: { original: { url } } });
  assert.equal(pickBackground([image("poster", true, "p"), image("background", false, "b1"), image("background", true, "b2")]), "b2");
  assert.equal(pickBackground([image("background", false, "b1")]), "b1");
  assert.equal(pickBackground([image("poster", true, "p")]), null);
  assert.equal(pickBackground(), null);
});

test("parseRoute reads show and list links", () => {
  assert.deepEqual(parseRoute("#show/169"), { view: "show", id: 169 });
  assert.deepEqual(parseRoute("#list"), { view: "list" });
  assert.deepEqual(parseRoute("#show/abc"), { view: "home" });
  assert.deepEqual(parseRoute(""), { view: "home" });
});

test("toggleInList adds to the front and removes again", () => {
  assert.deepEqual(toggleInList([1, 2], 3), [3, 1, 2]);
  assert.deepEqual(toggleInList([3, 1, 2], 1), [3, 2]);
});

test("bySeason groups episodes in order", () => {
  const seasons = bySeason([
    { season: 1, number: 1 },
    { season: 1, number: 2 },
    { season: 2, number: 1 },
  ]);
  assert.deepEqual([...seasons.keys()], [1, 2]);
  assert.equal(seasons.get(1).length, 2);
});
