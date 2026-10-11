const config = window.NXTUP_CONFIG || {};

const els = {
  status: document.getElementById("status"),
  points: document.getElementById("points"),
  summary: document.getElementById("summary"),
  filters: document.getElementById("filters"),
  filterRarity: document.getElementById("filter-rarity"),
  sort: document.getElementById("sort"),
  listings: document.getElementById("listings"),
  empty: document.getElementById("empty"),
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

function formatRemaining(iso) {
  const ms = new Date(iso) - new Date();
  if (ms <= 0) return "ended";
  const totalMinutes = Math.ceil(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? h + "h " + m + "m" : m + "m";
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
    setStatusWithLink("Sign in with Discord to use the marketplace.", "index.html", "Go to sign in");
    return;
  }
  const userId = sessionData.session.user.id;

  let points = 0;
  let listings = [];

  async function load() {
    const [profileRes, listingsRes] = await Promise.all([
      client.from("profiles").select("points").eq("id", userId).single(),
      client.from("market_listings").select("*"),
    ]);

    if (profileRes.data) {
      points = profileRes.data.points;
      els.points.textContent = points.toLocaleString();
    }
    if (listingsRes.error) {
      setStatus("Could not load listings: " + listingsRes.error.message);
      return;
    }
    listings = listingsRes.data || [];
    buildRarityFilter();
    render();
  }

  function buildRarityFilter() {
    const current = els.filterRarity.value;
    const rarities = new Map();
    listings.forEach((l) => rarities.set(l.rarity, l.rarity_order));
    const names = [...rarities.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);

    els.filterRarity.replaceChildren(new Option("All rarities", ""));
    names.forEach((name) => els.filterRarity.appendChild(new Option(name, name)));
    els.filterRarity.value = names.includes(current) ? current : "";
  }

  function visibleListings() {
    const now = new Date();
    let rows = listings.filter(
      (l) =>
        new Date(l.expires_at) > now &&
        (!els.filterRarity.value || l.rarity === els.filterRarity.value)
    );
    const sorts = {
      newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
      ending: (a, b) => new Date(a.expires_at) - new Date(b.expires_at),
      "price-asc": (a, b) => a.price - b.price,
      "price-desc": (a, b) => b.price - a.price,
      rarity: (a, b) => b.rarity_order - a.rarity_order || b.rating - a.rating,
    };
    return rows.sort(sorts[els.sort.value] || sorts.newest);
  }

  function buildItem(l) {
    const li = document.createElement("li");
    li.className = "item";
    li.appendChild(window.NXTUP_buildCard(l));

    const foot = document.createElement("div");
    foot.className = "item-foot";

    const price = document.createElement("p");
    price.className = "price";
    price.textContent = l.price.toLocaleString() + " points";

    const sub = document.createElement("p");
    sub.className = "price-sub";
    const mine = l.seller_id === userId;
    sub.textContent = mine ? "Your listing" : "Sold by " + l.seller_name;

    const left = document.createElement("p");
    left.className = "price-sub";
    left.textContent = "Ends in " + formatRemaining(l.expires_at);

    foot.append(price, sub, left);

    if (!mine) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary";
      btn.textContent = "Buy";
      btn.disabled = points < l.price;
      if (points < l.price) sub.textContent += ". You need " + (l.price - points).toLocaleString() + " more points.";
      btn.addEventListener("click", () => buy(l));
      foot.appendChild(btn);
    }

    li.appendChild(foot);
    return li;
  }

  function render() {
    const rows = visibleListings();
    els.listings.replaceChildren(...rows.map(buildItem));
    els.filters.hidden = listings.length === 0;
    els.empty.hidden = rows.length > 0;
    els.empty.textContent =
      listings.length === 0 ? "No cards are listed right now." : "No listings match this filter.";
    els.summary.textContent = listings.length
      ? listings.length.toLocaleString() + " card" + (listings.length === 1 ? "" : "s") + " for sale."
      : "";
  }

  async function buy(l) {
    if (!window.confirm("Buy " + l.player + " (" + l.rarity + ") for " + l.price.toLocaleString() + " points?")) return;
    setStatus("");
    const { error } = await client.rpc("buy_listing", { p_listing_id: l.listing_id });
    if (error) setStatus("Could not buy this card: " + error.message);
    else setStatus("Bought " + l.player + ". It is now in your collection.");
    await load();
  }

  els.filterRarity.addEventListener("change", render);
  els.sort.addEventListener("change", render);

  // Keep the countdowns fresh and drop listings as their timers end.
  setInterval(render, 30000);

  await load();
}
