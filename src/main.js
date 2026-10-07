import { loadCatalog, loadDetails, loadImages, searchShows } from "./api.js";
import { buildRows, bySeason, featured, parseRoute, pickBackground, plainText, toggleInList, years } from "./catalog.js";

const LIST_KEY = "reelhouse:list";
const SLIDE_MS = 9000;

const $ = (selector, scope = document) => scope.querySelector(selector);
const root = document.documentElement;
const dialog = $("#details");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");

const storage = {
  read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage blocked: My List lasts for this visit.
    }
  },
};

/** Only TVmaze's image host is trusted for image URLs, whatever ends up in storage. */
const safeImage = (url) => (typeof url === "string" && url.startsWith("https://static.tvmaze.com/") ? url : null);

const savedList = storage.read(LIST_KEY, []);
const state = {
  byId: new Map(),
  rows: [],
  list: Array.isArray(savedList) ? savedList.filter((s) => Number.isInteger(s?.id) && typeof s?.name === "string") : [],
  detailsId: null,
};

/** Build an element; text always goes in as text, never as HTML. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "style") node.style.cssText = value;
    else if (key in node && !key.includes("-")) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

const ICONS = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="plus-v" d="M12 5v14"/><path d="M5 12h14" class="plus-h"/><path class="tick" d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
};

function announce(message) {
  $("#announce").textContent = message;
}

/* ---------- My List ---------- */

const inList = (id) => state.list.some((show) => show.id === id);

function toggleList(show) {
  const known = new Map(state.list.map((s) => [s.id, s]));
  known.set(show.id, show);
  state.list = toggleInList(
    state.list.map((s) => s.id),
    show.id,
  ).map((id) => known.get(id));
  storage.write(LIST_KEY, state.list);
  const added = inList(show.id);
  announce(added ? `Added ${show.name} to My List` : `Removed ${show.name} from My List`);
  syncListButtons();
  renderListRow();
  if (parseRoute(location.hash).view === "list") renderListPage();
}

function listButton(button, show) {
  button.dataset.listId = show.id;
  button.innerHTML = `${ICONS.plus}<span>My List</span>`;
  syncListButtons();
}

function syncListButtons() {
  for (const button of document.querySelectorAll("[data-list-id]")) {
    const saved = inList(Number(button.dataset.listId));
    button.setAttribute("aria-pressed", String(saved));
    button.classList.toggle("saved", saved);
  }
  const count = state.list.length;
  $("#list-count").textContent = count ? String(count) : "";
}

/* ---------- cards and rows ---------- */

function poster(show, { eager = false } = {}) {
  const src = safeImage(show.poster);
  if (!src) return el("span", { class: "poster-missing", "aria-hidden": "true" }, show.name.slice(0, 1));
  return el("img", { src, alt: "", loading: eager ? "eager" : "lazy", decoding: "async", width: 210, height: 295 });
}

function card(show, { rank = 0, index = 0, eager = false } = {}) {
  state.byId.set(show.id, state.byId.get(show.id) ?? show);
  const meta = [show.rating ? `★ ${show.rating}` : null, years(show)].filter(Boolean).join(" · ");
  const button = el(
    "button",
    { class: "card", type: "button", "data-id": show.id, "aria-label": `${show.name}${show.rating ? `, rated ${show.rating}` : ""}` },
    poster(show, { eager }),
    el("span", { class: "card-info", "aria-hidden": "true" }, el("strong", {}, show.name), meta && el("span", {}, meta)),
  );
  return el(
    "li",
    { class: rank ? "ranked" : null, style: `--i:${Math.min(index, 8)}` },
    rank ? el("span", { class: "rank", "aria-hidden": "true" }, String(rank)) : null,
    button,
  );
}

function row(rowData, index) {
  const list = el(
    "ul",
    { class: "scroller" },
    rowData.items.map((show, i) => card(show, { rank: rowData.top ? i + 1 : 0, index: i, eager: index === 0 && i < 6 })),
  );
  const back = el("button", { class: "nudge back", type: "button", "aria-label": `Scroll ${rowData.title} back` });
  const forward = el("button", { class: "nudge forward", type: "button", "aria-label": `Scroll ${rowData.title} forward` });
  back.innerHTML = ICONS.left;
  forward.innerHTML = ICONS.right;
  const step = (direction) =>
    list.scrollBy({ left: direction * list.clientWidth * 0.85, behavior: reduceMotion.matches ? "auto" : "smooth" });
  back.addEventListener("click", () => step(-1));
  forward.addEventListener("click", () => step(1));
  const updateNudges = () => {
    back.disabled = list.scrollLeft < 8;
    forward.disabled = list.scrollLeft + list.clientWidth > list.scrollWidth - 8;
  };
  list.addEventListener("scroll", updateNudges, { passive: true });
  requestAnimationFrame(updateNudges);
  return el(
    "section",
    { class: `row reveal${rowData.top ? " top10" : ""}`, id: `row-${rowData.id}`, "aria-labelledby": `title-${rowData.id}` },
    el("h2", { id: `title-${rowData.id}` }, rowData.title),
    el("div", { class: "track" }, back, list, forward),
  );
}

function renderRows() {
  $("#rows").replaceChildren(...state.rows.map(row));
  renderListRow();
  observeReveals($("#rows"));
}

function renderListRow() {
  $("#row-mine")?.remove();
  if (!state.list.length || !state.rows.length) return;
  const section = row({ id: "mine", title: "My List", items: state.list }, 1);
  section.classList.add("in");
  $("#rows").insertBefore(section, $("#rows").children[1] ?? null);
}

function grid(target, shows) {
  target.replaceChildren(...shows.map((show, i) => card(show, { index: i })));
  target.classList.remove("in");
  void target.offsetWidth;
  target.classList.add("in");
}

/* ---------- billboard ---------- */

const billboard = { slides: [], current: -1, timer: 0, paused: false, hovering: false };

async function backgroundFor(show) {
  try {
    return safeImage(pickBackground(await loadImages(show.id)));
  } catch {
    return null;
  }
}

function preload(url) {
  if (url) new Image().src = url;
}

async function setUpBillboard(shows) {
  billboard.slides = featured(shows, 5).map((show) => ({ show, image: undefined }));
  $("#bb-dots").replaceChildren(
    ...billboard.slides.map((slide, i) => {
      const dot = el("button", { type: "button", class: "dot", "aria-label": `Show ${slide.show.name}` }, el("i"));
      dot.addEventListener("click", () => showSlide(i));
      return dot;
    }),
  );
  await showSlide(0);
  for (const slide of billboard.slides.slice(1)) {
    backgroundFor(slide.show).then((image) => {
      slide.image = image;
      preload(image);
    });
  }
}

async function showSlide(index) {
  const slide = billboard.slides[index];
  if (!slide) return;
  if (slide.image === undefined) slide.image = await backgroundFor(slide.show);
  billboard.current = index;
  const { show } = slide;

  const stage = $("#bb-stage");
  const layer = el("div", { class: `slide${slide.image ? "" : " fallback"}` });
  layer.style.backgroundImage = `url("${slide.image ?? safeImage(show.posterLarge) ?? safeImage(show.poster) ?? ""}")`;
  stage.append(layer);
  requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add("on")));
  setTimeout(() => {
    while (stage.children.length > 1) stage.firstElementChild.remove();
  }, 1400);

  $("#bb-index").textContent = `${index + 1}/${billboard.slides.length}`;
  $("#bb-title").textContent = show.name;
  $("#bb-meta").replaceChildren(
    ...[show.rating && `★ ${show.rating}`, years(show), show.genres.slice(0, 3).join(" · "), show.network]
      .filter(Boolean)
      .map((part) => el("span", {}, part)),
  );
  $("#bb-summary").textContent = show.summary;
  $("#bb-info").dataset.id = show.id;
  listButton($("#bb-list"), show);

  const content = $(".bb-content");
  content.classList.remove("swap");
  void content.offsetWidth;
  content.classList.add("swap");

  [...$("#bb-dots").children].forEach((dot, i) => {
    dot.toggleAttribute("aria-current", i === index);
    dot.classList.remove("running");
  });
  scheduleSlide();
}

function scheduleSlide() {
  clearTimeout(billboard.timer);
  const dot = $("#bb-dots").children[billboard.current];
  dot?.classList.remove("running");
  const stopped = billboard.paused || billboard.hovering || dialog.open || document.hidden || reduceMotion.matches;
  if (stopped || billboard.slides.length < 2) return;
  void dot?.offsetWidth;
  dot?.classList.add("running");
  billboard.timer = setTimeout(() => showSlide((billboard.current + 1) % billboard.slides.length), SLIDE_MS);
}

$("#bb-pause").addEventListener("click", (event) => {
  billboard.paused = !billboard.paused;
  event.currentTarget.setAttribute("aria-pressed", String(billboard.paused));
  event.currentTarget.setAttribute("aria-label", billboard.paused ? "Play slideshow" : "Pause slideshow");
  scheduleSlide();
});
$("#billboard").addEventListener("pointerenter", () => {
  billboard.hovering = true;
  scheduleSlide();
});
$("#billboard").addEventListener("pointerleave", () => {
  billboard.hovering = false;
  scheduleSlide();
});
$("#bb-info").addEventListener("click", (event) => goToShow(Number(event.currentTarget.dataset.id)));
$("#bb-list").addEventListener("click", () => toggleList(billboard.slides[billboard.current].show));
document.addEventListener("visibilitychange", scheduleSlide);

/* ---------- details ---------- */

let detailsRequest = null;
let pendingOrigin = null;

function goToShow(id, origin = null) {
  pendingOrigin = origin;
  history.pushState({ modal: true }, "", `#show/${id}`);
  route();
}

function chips(target, parts) {
  target.replaceChildren(...parts.filter(Boolean).map((part) => el("span", {}, part)));
}

function renderDetails(show, extra) {
  state.detailsId = show.id;
  $("#d-title").textContent = show.name;
  const backdrop = safeImage(pickBackground(extra?.images)) ?? safeImage(show.posterLarge) ?? safeImage(show.poster);
  const hero = $("#d-hero");
  hero.style.backgroundImage = backdrop ? `url("${backdrop}")` : "none";
  hero.classList.toggle("fallback", !extra?.images?.some((image) => image.type === "background"));
  const posterUrl = safeImage(show.poster);
  $("#d-poster").src = posterUrl ?? "";
  $("#d-poster").hidden = !posterUrl;
  chips($("#d-meta"), [
    show.rating && `★ ${show.rating}`,
    years(show),
    show.runtime && `${show.runtime} min`,
    show.network,
    show.language,
    show.status === "Running" ? "Still airing" : show.status,
  ]);
  $("#d-genres").replaceChildren(...show.genres.map((genre) => el("li", {}, genre)));
  $("#d-summary").textContent = show.summary || "No summary yet.";
  $("#d-tvmaze").href = `https://www.tvmaze.com/shows/${show.id}`;
  listButton($("#d-list"), show);

  const cast = extra?.cast ?? [];
  $("#d-cast-section").hidden = extra ? cast.length === 0 : false;
  $("#d-cast").replaceChildren(
    ...(extra
      ? cast.slice(0, 14).map(({ person, character }, i) => {
          const photo = safeImage(person?.image?.medium);
          return el(
            "li",
            { style: `--i:${Math.min(i, 8)}` },
            photo
              ? el("img", { src: photo, alt: "", loading: "lazy", width: 72, height: 72 })
              : el("span", { class: "initial", "aria-hidden": "true" }, (person?.name ?? "?").slice(0, 1)),
            el("strong", {}, person?.name ?? ""),
            character?.name ? el("span", {}, character.name) : null,
          );
        })
      : Array.from({ length: 6 }, () => el("li", { class: "skeleton" }))),
  );

  const seasons = bySeason(extra?.episodes ?? []);
  $("#d-episodes-section").hidden = extra ? seasons.size === 0 : false;
  const numbers = [...seasons.keys()];
  $("#d-seasons").replaceChildren(
    ...numbers.map((number, i) => {
      const tab = el("button", { type: "button", role: "tab", "aria-selected": String(i === 0) }, `Season ${number}`);
      tab.addEventListener("click", () => {
        for (const other of $("#d-seasons").children) other.setAttribute("aria-selected", String(other === tab));
        renderEpisodes(seasons.get(number));
      });
      return tab;
    }),
  );
  if (extra) renderEpisodes(seasons.get(numbers[0]) ?? []);
  else $("#d-episodes").replaceChildren(...Array.from({ length: 3 }, () => el("li", { class: "skeleton" })));
}

function renderEpisodes(episodes) {
  const list = $("#d-episodes");
  list.replaceChildren(
    ...episodes.map((episode, i) => {
      const still = safeImage(episode.image?.medium);
      return el(
        "li",
        { style: `--i:${Math.min(i, 10)}` },
        still ? el("img", { src: still, alt: "", loading: "lazy", width: 250, height: 140 }) : el("span", { class: "still-missing" }),
        el(
          "div",
          {},
          el("span", { class: "ep-number" }, `E${episode.number ?? "–"}`),
          el("strong", {}, episode.name ?? ""),
          el("span", { class: "ep-meta" }, [episode.airdate, episode.runtime && `${episode.runtime} min`].filter(Boolean).join(" · ")),
          el("p", {}, plainText(episode.summary)),
        ),
      );
    }),
  );
  list.classList.remove("in");
  void list.offsetWidth;
  list.classList.add("in");
}

async function openDetails(id) {
  if (dialog.open && state.detailsId === id) return;
  const known = state.byId.get(id) ?? state.list.find((show) => show.id === id);
  if (known) renderDetails(known, null);
  else renderDetails({ id, name: "Loading…", genres: [], summary: "" }, null);
  $("#d-error").hidden = true;
  showDialog(pendingOrigin);
  pendingOrigin = null;

  detailsRequest?.abort();
  const request = new AbortController();
  detailsRequest = request;
  try {
    const { show, extra } = await loadDetails(id, request.signal);
    if (request !== detailsRequest) return;
    state.byId.set(id, show);
    renderDetails(show, extra);
  } catch (error) {
    if (error.name !== "AbortError") $("#d-error").hidden = false;
  }
}

/** Open the dialog; where View Transitions exist, the clicked poster flies into place. */
function showDialog(origin) {
  if (dialog.open) return;
  const open = () => {
    dialog.showModal();
    dialog.scrollTop = 0;
    root.classList.add("modal-open");
    scheduleSlide();
  };
  if (!origin || !document.startViewTransition || reduceMotion.matches) return open();
  const target = $("#d-poster");
  origin.style.viewTransitionName = "poster";
  const transition = document.startViewTransition(() => {
    origin.style.viewTransitionName = "";
    target.style.viewTransitionName = "poster";
    open();
  });
  transition.finished.finally(() => {
    target.style.viewTransitionName = "";
  });
}

dialog.addEventListener("close", () => {
  root.classList.remove("modal-open");
  state.detailsId = null;
  detailsRequest?.abort();
  if (parseRoute(location.hash).view === "show") {
    if (history.state?.modal) history.back();
    else history.replaceState(null, "", location.pathname + location.search);
  }
  scheduleSlide();
});
$("#d-close").addEventListener("click", () => dialog.close());
// A click on the dimmed backdrop (outside the panel) closes the details.
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
$("#d-list").addEventListener("click", () => {
  const show = state.byId.get(state.detailsId);
  if (show) toggleList(show);
});

/* ---------- search ---------- */

const searchInput = $("#search-input");
let searchTimer = 0;
let searchRequest = null;

$("#search-toggle").addEventListener("click", () => {
  const open = !$(".search").classList.contains("open");
  $(".search").classList.toggle("open", open);
  $("#search-toggle").setAttribute("aria-expanded", String(open));
  if (open) searchInput.focus();
  else {
    searchInput.value = "";
    showView("home");
  }
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const query = searchInput.value.trim();
  if (query.length < 2) {
    searchRequest?.abort();
    showView(parseRoute(location.hash).view === "list" ? "list" : "home");
    return;
  }
  searchTimer = setTimeout(() => runSearch(query), 300);
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchInput.value = "";
    $(".search").classList.remove("open");
    $("#search-toggle").setAttribute("aria-expanded", "false");
    $("#search-toggle").focus();
    showView("home");
  }
});

async function runSearch(query) {
  searchRequest?.abort();
  const request = new AbortController();
  searchRequest = request;
  showView("results");
  $("#results-title").textContent = `Searching for “${query}”…`;
  try {
    const shows = await searchShows(query, request.signal);
    if (request !== searchRequest) return;
    $("#results-title").textContent = shows.length ? `Results for “${query}”` : `Nothing found for “${query}”`;
    grid($("#results-grid"), shows);
    announce(`${shows.length} results for ${query}`);
  } catch (error) {
    if (error.name !== "AbortError") $("#results-title").textContent = "Search failed. Check your connection and try again.";
  }
}

/* ---------- views and routing ---------- */

function showView(view) {
  const home = view === "home";
  $("#billboard").hidden = !home;
  $("#rows").hidden = !home;
  $("#results").hidden = view !== "results";
  $("#mylist").hidden = view !== "list";
  for (const link of document.querySelectorAll("[data-nav]")) {
    if (link.dataset.nav === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (view === "list") renderListPage();
  scheduleSlide();
}

function renderListPage() {
  grid($("#mylist-grid"), state.list);
  $("#mylist-empty").hidden = state.list.length > 0;
}

function route() {
  const target = parseRoute(location.hash);
  if (target.view === "show") {
    openDetails(target.id);
    return;
  }
  if (dialog.open) dialog.close();
  if (!searchInput.value.trim()) showView(target.view);
}

addEventListener("popstate", route);
addEventListener("hashchange", route);

document.addEventListener("click", (event) => {
  const button = event.target.closest(".card");
  if (!button) return;
  goToShow(Number(button.dataset.id), button.querySelector("img"));
});

/* ---------- motion ---------- */

let revealer = null;
function observeReveals(scope) {
  for (const node of scope.querySelectorAll(".reveal:not(.in)")) {
    if (revealer) revealer.observe(node);
    else node.classList.add("in");
  }
}
if (!reduceMotion.matches && "IntersectionObserver" in window) {
  revealer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        revealer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
}

new IntersectionObserver(([entry]) => root.classList.toggle("scrolled", !entry.isIntersecting)).observe($("#top-sentinel"));

// Posters tilt toward the pointer.
document.addEventListener("pointermove", (event) => {
  if (!finePointer.matches || reduceMotion.matches) return;
  const target = event.target.closest?.(".card");
  if (!target) return;
  const box = target.getBoundingClientRect();
  target.style.setProperty("--ry", `${(((event.clientX - box.left) / box.width - 0.5) * 14).toFixed(1)}deg`);
  target.style.setProperty("--rx", `${((0.5 - (event.clientY - box.top) / box.height) * 10).toFixed(1)}deg`);
});
document.addEventListener(
  "pointerout",
  (event) => {
    const target = event.target.closest?.(".card");
    if (target && !target.contains(event.relatedTarget)) {
      target.style.removeProperty("--rx");
      target.style.removeProperty("--ry");
    }
  },
  true,
);

/* ---------- start ---------- */

async function start() {
  $("#load-error").hidden = true;
  try {
    const shows = await loadCatalog();
    for (const show of shows) state.byId.set(show.id, show);
    state.rows = buildRows(shows);
    renderRows();
    syncListButtons();
    route();
    await setUpBillboard(shows);
  } catch {
    $("#rows").replaceChildren();
    $("#load-error").hidden = false;
  }
}

$("#retry").addEventListener("click", start);
syncListButtons();
start();
