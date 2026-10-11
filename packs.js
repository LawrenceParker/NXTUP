const config = window.NXTUP_CONFIG || {};

const els = {
  status: document.getElementById("status"),
  points: document.getElementById("points"),
  packs: document.getElementById("packs"),
  stageSection: document.getElementById("stage-section"),
  stage: document.getElementById("pack-cards"),
  revealAll: document.getElementById("reveal-all"),
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function start() {
  const client = window.NXTUP_client || window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    setStatusWithLink("Sign in with Discord to open packs.", "index.html", "Go to sign in");
    return;
  }
  const userId = sessionData.session.user.id;

  const [packsRes, raritiesRes, oddsRes] = await Promise.all([
    client
      .from("packs")
      .select("id, name, cost, card_count, sort_order, description, color")
      .order("sort_order", { ascending: true }),
    client.from("rarities").select("name, drop_weight, sort_order"),
    client.from("pack_odds").select("pack_name, rarity, drop_weight"),
  ]);

  if (packsRes.error) {
    setStatus("Could not load packs. Check that 08_packs_table.sql ran without errors.");
    return;
  }
  const packs = packsRes.data || [];
  if (packs.length === 0) {
    setStatus("No packs have been set up yet. Import packs.csv into the packs table.");
    return;
  }

  let points = 0;
  let busy = false;
  const tiles = []; // { pack, button, need, art }

  // ---- drop chances for a pack (its own odds, or the standard ones) -------

  function oddsFor(pack) {
    const rarities = raritiesRes.data || [];
    const orderOf = (name) => {
      const r = rarities.find((x) => x.name === name);
      return r ? r.sort_order : 0;
    };
    const custom = (oddsRes.data || []).filter((o) => o.pack_name === pack.name);
    const rows = custom.length
      ? custom.map((o) => ({ name: o.rarity, weight: Number(o.drop_weight), order: orderOf(o.rarity) }))
      : rarities.map((r) => ({ name: r.name, weight: Number(r.drop_weight), order: r.sort_order }));
    const usable = rows.filter((r) => r.weight > 0).sort((a, b) => b.order - a.order);
    const total = usable.reduce((sum, r) => sum + r.weight, 0);
    return usable.map((r) => ({ name: r.name, pct: total ? (r.weight / total) * 100 : 0 }));
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

    const odds = oddsFor(pack);
    if (odds.length) {
      const details = document.createElement("details");
      details.className = "pack-odds";
      const summary = document.createElement("summary");
      summary.textContent = "Drop chances";
      const list = document.createElement("ul");
      list.className = "odds";
      odds.forEach((o) => {
        const item = document.createElement("li");
        const strong = document.createElement("strong");
        strong.textContent = o.name;
        item.append(strong, " " + (o.pct < 1 ? o.pct.toFixed(1) : Math.round(o.pct)) + "%");
        list.appendChild(item);
      });
      details.append(summary, list);
      body.appendChild(details);
    }

    li.append(art, body);
    tiles.push({ pack, button, need, art });
    return li;
  }

  els.packs.replaceChildren(...packs.map(buildPack));

  // ---- buttons follow points, busy state and unrevealed cards ----------------

  function unrevealedCount() {
    return els.stage.querySelectorAll(".flip:not(.is-flipped)").length;
  }

  function updateButtons() {
    const pending = unrevealedCount() > 0;
    tiles.forEach(({ pack, button, need }) => {
      const short = pack.cost - points;
      button.disabled = busy || pending || short > 0;
      need.textContent = short > 0 ? "You need " + short.toLocaleString() + " more points." : "";
    });
    els.revealAll.hidden = !pending;
    if (pending) setStatus("Reveal your cards to open another pack.");
    else if (els.status.textContent === "Reveal your cards to open another pack.") setStatus("");
  }

  async function refreshPoints() {
    const { data } = await client.from("profiles").select("points").eq("id", userId).single();
    points = data ? data.points : 0;
    els.points.textContent = points.toLocaleString();
    updateButtons();
  }

  // ---- showing a pull ----------------------------------------------------------

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
    const hint = document.createElement("span");
    hint.className = "flip-back-hint";
    hint.textContent = "Reveal";
    back.append(mark, hint);

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

  function showPull(cards) {
    els.stage.replaceChildren(...cards.map(buildDealt));
    els.stageSection.hidden = false;
    els.stageSection.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }

  els.revealAll.addEventListener("click", () => {
    const backs = [...els.stage.querySelectorAll(".flip:not(.is-flipped) .flip-back")];
    backs.forEach((back, i) => setTimeout(() => back.click(), reducedMotion ? 0 : i * 140));
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
      setStatus(
        error.message.includes("Not enough points")
          ? "You do not have enough points for that pack."
          : "Could not open the pack: " + error.message
      );
      return;
    }

    showPull(data);
    await refreshPoints();
  }

  await refreshPoints();
}
