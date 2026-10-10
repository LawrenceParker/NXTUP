const config = window.NXTUP_CONFIG || {};

const els = {
  status: document.getElementById("status"),
  points: document.getElementById("points"),
  info: document.getElementById("pack-info"),
  open: document.getElementById("open"),
  revealAll: document.getElementById("reveal-all"),
  cards: document.getElementById("pack-cards"),
  oddsSection: document.getElementById("odds-section"),
  odds: document.getElementById("odds"),
};

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
  const client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    setStatusWithLink("Sign in with Discord to open packs.", "index.html", "Go to sign in");
    return;
  }
  const userId = sessionData.session.user.id;

  const [settingsRes, raritiesRes] = await Promise.all([
    client.from("settings").select("key, value").in("key", ["pack_cost", "pack_card_count"]),
    client.from("rarities").select("name, drop_weight, sort_order").order("sort_order", { ascending: false }),
  ]);

  const settings = Object.fromEntries((settingsRes.data || []).map((s) => [s.key, Number(s.value)]));
  const cost = settings.pack_cost;
  const count = settings.pack_card_count;

  if (!cost || !count) {
    setStatus("Pack settings are missing. Check that 02_packs.sql ran without errors.");
    return;
  }

  els.info.textContent = count + " cards for " + cost.toLocaleString() + " points.";
  els.open.textContent = "Open pack (" + cost.toLocaleString() + " points)";

  let points = 0;

  async function refreshPoints() {
    const { data } = await client.from("profiles").select("points").eq("id", userId).single();
    points = data ? data.points : 0;
    els.points.textContent = points.toLocaleString();
    updateOpenButton();
  }

  // The open button stays off while cards are still face down,
  // so a new pack can never replace an unrevealed one on screen.
  function updateOpenButton() {
    const pending = els.cards.querySelectorAll(".card-back").length > 0;
    els.open.disabled = pending || points < cost;
    if (pending) {
      setStatus("Reveal your cards to open another pack.");
    } else if (points < cost) {
      setStatus("You need " + cost.toLocaleString() + " points to open a pack. Make predictions to earn more.");
    } else {
      setStatus("");
    }
  }

  function renderOdds() {
    const rarities = (raritiesRes.data || []).filter((r) => Number(r.drop_weight) > 0);
    const total = rarities.reduce((sum, r) => sum + Number(r.drop_weight), 0);
    if (!total) return;
    els.odds.replaceChildren(
      ...rarities.map((r) => {
        const li = document.createElement("li");
        const strong = document.createElement("strong");
        strong.textContent = r.name;
        const pct = (Number(r.drop_weight) / total) * 100;
        li.append(strong, " " + (pct < 1 ? pct.toFixed(1) : Math.round(pct)) + "%");
        return li;
      })
    );
    els.oddsSection.hidden = false;
  }

  function showPack(cards) {
    els.cards.replaceChildren(
      ...cards.map((card) => {
        const li = document.createElement("li");
        const back = document.createElement("button");
        back.type = "button";
        back.className = "card-back";
        if (card.rarity_color) back.style.setProperty("--rarity", card.rarity_color);
        back.textContent = "Reveal card";
        back.addEventListener("click", () => {
          li.replaceChildren(window.NXTUP_buildCard(card));
          updateRevealAll();
        });
        li.appendChild(back);
        return li;
      })
    );
    els.revealAll.hidden = false;
  }

  function updateRevealAll() {
    els.revealAll.hidden = els.cards.querySelectorAll(".card-back").length === 0;
    updateOpenButton();
  }

  els.revealAll.addEventListener("click", () => {
    els.cards.querySelectorAll(".card-back").forEach((btn) => btn.click());
  });

  els.open.addEventListener("click", async () => {
    setStatus("");
    els.open.disabled = true;
    els.cards.replaceChildren();
    els.revealAll.hidden = true;

    const { data, error } = await client.rpc("open_pack");

    if (error) {
      await refreshPoints();
      setStatus(
        error.message.includes("Not enough points")
          ? "You do not have enough points for a pack."
          : "Could not open the pack: " + error.message
      );
      return;
    }

    showPack(data);
    await refreshPoints();
    els.open.textContent = "Open another pack (" + cost.toLocaleString() + " points)";
  });

  renderOdds();
  await refreshPoints();
}
