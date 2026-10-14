const config = window.NXTUP_CONFIG || {};

const els = {
  status: document.getElementById("status"),
  points: document.getElementById("points"),
  packs: document.getElementById("packs"),
  stageSection: document.getElementById("stage-section"),
  stage: document.getElementById("pack-cards"),
  skip: document.getElementById("reveal-all"),
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const REVEALING = "Revealing your cards...";

function setStatus(message) {
  els.status.textContent = message || "";
}

function setStatusWithLink(message, href, linkText) {
  els.status.textContent = message + " ";
  const a = document.createElement("a");
  a.href = href;
  a.textContent = linkText;
  els.status.appendChild(a);
}

if (!window.supabase || !config.SUPABASE_URL || config.SUPABASE_URL.startsWith("PASTE")) {
  setStatus("Supabase is not set up. Check config.js.");
} else {
  start().catch((err) => setStatus("Something went wrong: " + err.message));
}

// "2d 4h left", "3h 20m left", "12m left"
function timeLeft(untilIso) {
  const ms = new Date(untilIso) - new Date();
  if (ms <= 0) return "ended";
  const minutes = Math.ceil(ms / 60000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return d + "d " + h + "h left";
  if (h > 0) return h + "h " + m + "m left";
  return m + "m left";
}

async function start() {
  const client = window.NXTUP_client || window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    setStatusWithLink("Sign in with Discord to open packs.", "index.html", "Go to sign in");
    return;
  }
  const userId = sessionData.session.user.id;

  // Newer columns (limited-time packs, per-card odds) come from 12_pack_events.sql.
  // If that has not been run yet, fall back so the page still works.
  let packsRes = await client
    .from("packs")
    .select("id, name, cost, card_count, sort_order, description, color, from_at, until_at")
    .order("sort_order", { ascending: true });
  if (packsRes.error) {
    packsRes = await client
      .from("packs")
      .select("id, name, cost, card_count, sort_order, description, color")
      .order("sort_order", { ascending: true });
  }
  let oddsRes = await client.from("pack_odds").select("pack_name, rarity, drop_weight, slot");
  if (oddsRes.error) oddsRes = await client.from("pack_odds").select("pack_name, rarity, drop_weight");
  const raritiesRes = await client.from("rarities").select("name, drop_weight, sort_order");

  if (packsRes.error) {
    setStatus("Could not load packs. Check that 08_packs_table.sql ran without errors.");
    return;
  }
  const allPacks = packsRes.data || [];

  let points = 0;
  let busy = false;
  let tiles = []; // { pack, button, need, left }
  let shownIds = "";
  let revealTimers = [];

  // A pack is live when its window (if it has one) includes right now.
  function isLive(pack) {
    const now = new Date();
    if (pack.from_at && new Date(pack.from_at) > now) return false;
    if (pack.until_at && new Date(pack.until_at) <= now) return false;
    return true;
  }

  // ---- drop chances: whole pack, plus any card-specific lists ---------------

  function oddsSections(pack) {
    const rarities = raritiesRes.data || [];
    const orderOf = (name) => {
      const r = rarities.find((x) => x.name === name);
      return r ? r.sort_order : 0;
    };
    const asList = (items) => {
      const usable = items.filter((r) => r.weight > 0).sort((a, b) => b.order - a.order);
      const total = usable.reduce((sum, r) => sum + r.weight, 0);
      return usable.map((r) => ({ name: r.name, pct: total ? (r.weight / total) * 100 : 0 }));
    };
    const fromRows = (rows) =>
      rows.map((o) => ({ name: o.rarity, weight: Number(o.drop_weight), order: orderOf(o.rarity) }));

    const rows = (oddsRes.data || []).filter((o) => o.pack_name === pack.name);
    const general = rows.filter((o) => o.slot == null);
    const slotNumbers = [...new Set(rows.filter((o) => o.slot != null).map((o) => Number(o.slot)))]
      .filter((n) => n <= pack.card_count)
      .sort((a, b) => a - b);

    const standard = rarities.map((r) => ({ name: r.name, weight: Number(r.drop_weight), order: r.sort_order }));
    const sections = [];

    if (slotNumbers.length < pack.card_count) {
      sections.push({
        label: slotNumbers.length ? "Other cards" : null,
        list: asList(general.length ? fromRows(general) : standard),
      });
    }
    slotNumbers.forEach((n) => {
      sections.push({ label: "Card " + n, list: asList(fromRows(rows.filter((o) => Number(o.slot) === n))) });
    });
    return sections.filter((s) => s.list.length);
  }

  // ---- pack tiles ----------------------------------------------------------

  function buildPack(pack) {
    const li = document.createElement("li");
    li.className = "pack";
    if (pack.color) li.style.setProperty("--pack", pack.color);

    const art = document.createElement("div");
    art.className = "pack-art";
    const artName = document.createElement("span");
    artName.className = "pack-art-name";
    artName.textContent = pack.name;
    const artCount = document.createElement("span");
    artCount.className = "pack-art-count";
    artCount.textContent = pack.card_count + (pack.card_count === 1 ? " card" : " cards");
    art.append(artName, artCount);

    const body = document.createElement("div");
    body.className = "pack-body";

    let left = null;
    if (pack.until_at) {
      left = document.createElement("p");
      left.className = "pack-limited";
      body.appendChild(left);
    }

    if (pack.description) {
      const desc = document.createElement("p");
      desc.className = "pack-desc";
      desc.textContent = pack.description;
      body.appendChild(desc);
    }

    const cost = document.createElement("p");
    cost.className = "pack-cost";
    const costNum = document.createElement("span");
    costNum.textContent = pack.cost.toLocaleString();
    cost.append(costNum, " points");

    const need = document.createElement("p");
    need.className = "pack-need";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-primary";
    button.textContent = "Open pack";
    button.addEventListener("click", () => openPack(pack, art));

    body.append(cost, need, button);

    const sections = oddsSections(pack);
    if (sections.length) {
      const details = document.createElement("details");
      details.className = "pack-odds";
      const summary = document.createElement("summary");
      summary.textContent = "Drop chances";
      details.appendChild(summary);
      sections.forEach((section) => {
        if (section.label) {
          const label = document.createElement("p");
          label.className = "odds-label";
          label.textContent = section.label;
          details.appendChild(label);
        }
        const list = document.createElement("ul");
        list.className = "odds";
        section.list.forEach((o) => {
          const item = document.createElement("li");
          const strong = document.createElement("strong");
          strong.textContent = o.name;
          item.append(strong, " " + (o.pct < 1 ? o.pct.toFixed(1) : Math.round(o.pct)) + "%");
          list.appendChild(item);
        });
        details.appendChild(list);
      });
      body.appendChild(details);
    }

    li.append(art, body);
    tiles.push({ pack, button, need, left });
    return li;
  }

  function showTiles() {
    const live = allPacks.filter(isLive);
    shownIds = live.map((p) => p.id).join(",");
    tiles = [];
    els.packs.replaceChildren(...live.map(buildPack));
    if (live.length === 0) {
      const none = document.createElement("li");
      none.className = "section-note";
      none.textContent = "No packs are available right now. Check back soon.";
      els.packs.appendChild(none);
    }
    updateButtons();
  }

  // ---- buttons follow points, busy state and unrevealed cards ----------------

  function unrevealedCount() {
    return els.stage.querySelectorAll(".flip:not(.is-flipped)").length;
  }

  function updateButtons() {
    const pending = unrevealedCount() > 0;
    tiles.forEach(({ pack, button, need, left }) => {
      const ended = pack.until_at && new Date(pack.until_at) <= new Date();
      const short = pack.cost - points;
      button.disabled = busy || pending || short > 0 || Boolean(ended);
      need.textContent = ended
        ? "This pack has ended."
        : short > 0
        ? "You need " + short.toLocaleString() + " more points."
        : "";
      if (left) left.textContent = ended ? "Limited time. Ended" : "Limited time. " + timeLeft(pack.until_at);
    });
    els.skip.hidden = !pending;
    if (pending) setStatus(REVEALING);
    else if (els.status.textContent === REVEALING) setStatus("");
  }

  async function refreshPoints() {
    const { data } = await client.from("profiles").select("points").eq("id", userId).single();
    points = data ? data.points : 0;
    els.points.textContent = points.toLocaleString();
    updateButtons();
  }

  // ---- showing a pull: cards deal out, then flip one by one, left to right ---

  function flipCard(flip, back, front) {
    if (flip.classList.contains("is-flipped")) return;
    flip.classList.add("is-flipped");
    front.removeAttribute("aria-hidden");
    back.tabIndex = -1;
    back.setAttribute("aria-hidden", "true");
    updateButtons();
  }

  function buildDealt(card, index) {
    const li = document.createElement("li");
    li.className = "deal";
    li.style.animationDelay = index * 90 + "ms";

    const flip = document.createElement("div");
    flip.className = "flip";
    const inner = document.createElement("div");
    inner.className = "flip-inner";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "flip-face flip-back";
    back.setAttribute("aria-label", "Reveal card " + (index + 1));
    const mark = document.createElement("span");
    mark.className = "flip-back-mark";
    mark.textContent = "NXTUP";
    back.appendChild(mark);

    const front = document.createElement("div");
    front.className = "flip-face flip-front";
    front.setAttribute("aria-hidden", "true");
    front.appendChild(window.NXTUP_buildCard(card));

    back.addEventListener("click", () => flipCard(flip, back, front));

    inner.append(back, front);
    flip.appendChild(inner);
    li.appendChild(flip);
    return li;
  }

  function cancelReveal() {
    revealTimers.forEach(clearTimeout);
    revealTimers = [];
  }

  // Wait for the deal animation, then flip each card in turn. The last card
  // (the best one) gets a slightly longer pause. Clicking a card flips it early.
  function autoReveal() {
    cancelReveal();
    const backs = [...els.stage.querySelectorAll(".flip-back")];
    if (reducedMotion) {
      backs.forEach((b) => b.click());
      return;
    }
    let at = (backs.length - 1) * 90 + 450 + 300; // deal animation + a beat
    backs.forEach((back, i) => {
      if (i === backs.length - 1 && backs.length > 1) at += 300;
      revealTimers.push(setTimeout(() => back.click(), at));
      at += 620;
    });
  }

  function showPull(cards) {
    cancelReveal();
    els.stage.replaceChildren(...cards.map(buildDealt));
    els.stageSection.hidden = false;
    els.stageSection.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    autoReveal();
  }

  els.skip.addEventListener("click", () => {
    cancelReveal();
    els.stage.querySelectorAll(".flip:not(.is-flipped) .flip-back").forEach((back) => back.click());
  });

  // ---- opening a pack ----------------------------------------------------------

  async function openPack(pack, art) {
    if (busy) return;
    busy = true;
    setStatus("");
    updateButtons();

    // The pack shakes while the server does the work (and for at least 0.7s).
    art.classList.add("is-shaking");
    const [{ data, error }] = await Promise.all([
      client.rpc("open_pack", { p_pack_id: pack.id }),
      sleep(reducedMotion ? 0 : 700),
    ]);
    art.classList.remove("is-shaking");
    busy = false;

    if (error) {
      await refreshPoints();
      const text = error.message || "";
      setStatus(
        text.includes("Not enough points")
          ? "You do not have enough points for that pack."
          : text.includes("no longer available")
          ? "That pack has just ended."
          : text.includes("not available yet")
          ? "That pack is not available yet."
          : "Could not open the pack: " + text
      );
      return;
    }

    showPull(data);
    await refreshPoints();
  }

  // Keep countdowns fresh; add or remove packs as their windows open and close
  // (only while nothing is being opened or revealed).
  setInterval(() => {
    const idle = !busy && unrevealedCount() === 0;
    const liveIds = allPacks.filter(isLive).map((p) => p.id).join(",");
    if (idle && liveIds !== shownIds) showTiles();
    else updateButtons();
  }, 30000);

  showTiles();
  await refreshPoints();
}
