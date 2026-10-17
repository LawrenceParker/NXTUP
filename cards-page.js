// Cards page: every card you own, one tile per card. Copies of the same card
// do not stack, so each one can be listed or quick sold on its own.

const config = window.NXTUP_CONFIG || {};

const els = {
  status: document.getElementById("status"),
  summary: document.getElementById("summary"),
  filters: document.getElementById("filters"),
  filterEvent: document.getElementById("filter-event"),
  sort: document.getElementById("sort"),
  cards: document.getElementById("cards"),
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

// The database returns at most 1000 rows per request, so read in pages.
async function fetchAll(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await makeQuery().range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
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
    setStatusWithLink("Sign in with Discord to see your cards.", "index.html", "Go to sign in");
    return;
  }
  const userId = sessionData.session.user.id;

  let owned = [];
  let quickSellPercent = null;
  let durations = [1];
  let defaultHours = 1;

  async function load() {
    const [profileRes, settingsRes, rows] = await Promise.all([
      client.from("profiles").select("points").eq("id", userId).single(),
      client
        .from("settings")
        .select("key, value")
        .in("key", ["quick_sell_percent", "listing_durations_hours", "default_listing_hours"]),
      fetchAll(() => client.from("my_cards").select("*").order("user_card_id", { ascending: true })),
    ]);

    const pointsEl = document.getElementById("points");
    if (profileRes.data && pointsEl) pointsEl.textContent = profileRes.data.points.toLocaleString();

    if (settingsRes.data) {
      const s = Object.fromEntries(settingsRes.data.map((row) => [row.key, row.value]));
      if (s.quick_sell_percent != null) quickSellPercent = Number(s.quick_sell_percent);
      if (s.listing_durations_hours) {
        const list = s.listing_durations_hours
          .split(",")
          .map((x) => Number(x.trim()))
          .filter((n) => Number.isInteger(n) && n > 0);
        if (list.length) durations = list;
      }
      if (s.default_listing_hours) defaultHours = Number(s.default_listing_hours);
    }

    owned = rows;
    buildEventFilter();
    render();
  }

  function quickSellValue(card) {
    if (quickSellPercent == null || !card.min_price) return null;
    return Math.round((card.min_price * quickSellPercent) / 100);
  }

  function buildEventFilter() {
    const current = els.filterEvent.value;
    const events = [...new Set(owned.map((c) => c.event).filter(Boolean))].sort((a, b) =>
      window.NXTUP_prettyEvent(a).localeCompare(window.NXTUP_prettyEvent(b))
    );
    els.filterEvent.replaceChildren(new Option("All events", ""));
    events.forEach((e) => els.filterEvent.appendChild(new Option(window.NXTUP_prettyEvent(e), e)));
    els.filterEvent.value = events.includes(current) ? current : "";
  }

  // "Brawk, Initiator, Kickoff, OVR 77" for the confirmation boxes
  function describe(c) {
    return [c.player, c.role, c.event_label, c.rating == null ? null : "OVR " + c.rating].filter(Boolean).join(", ");
  }

  // The controls under each card: list it, or quick sell it.
  function buildFooter(copy) {
    const foot = document.createElement("div");
    foot.className = "item-foot";

    if (copy.listing_id) {
      const line = document.createElement("p");
      line.className = "price";
      line.textContent = "Listed for " + copy.listing_price.toLocaleString() + " points";
      const left = document.createElement("p");
      left.className = "price-sub";
      left.textContent = "Ends in " + formatRemaining(copy.listing_expires_at);
      foot.append(line, left);
      return foot;
    }

    if (!(copy.min_price > 0)) {
      const note = document.createElement("p");
      note.className = "price-sub";
      note.textContent = "No minimum price is set for this tier yet.";
      foot.appendChild(note);
      return foot;
    }

    const sub = document.createElement("p");
    sub.className = "price-sub";
    sub.textContent = "Minimum price: " + copy.min_price.toLocaleString() + " points";

    let hours = durations.includes(defaultHours) ? defaultHours : durations[0];
    const tabs = document.createElement("div");
    tabs.className = "tabs";
    tabs.setAttribute("role", "radiogroup");
    tabs.setAttribute("aria-label", "Listing length");
    durations.forEach((h) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "tab";
      tab.textContent = h + (h === 1 ? " hr" : " hrs");
      tab.setAttribute("role", "radio");
      tab.setAttribute("aria-checked", String(h === hours));
      tab.addEventListener("click", () => {
        hours = h;
        tabs.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-checked", String(t === tab)));
      });
      tabs.appendChild(tab);
    });

    const row = document.createElement("div");
    row.className = "row";
    const field = document.createElement("label");
    field.className = "field";
    field.textContent = "Your price";
    const input = document.createElement("input");
    input.type = "number";
    input.min = copy.min_price;
    input.step = 1;
    input.value = copy.min_price;
    field.appendChild(input);

    const listBtn = document.createElement("button");
    listBtn.type = "button";
    listBtn.className = "btn btn-primary";
    listBtn.textContent = "List";
    listBtn.addEventListener("click", () => listCard(copy, Number(input.value), hours));
    row.append(field, listBtn);

    foot.append(sub, tabs, row);

    const value = quickSellValue(copy);
    if (value != null) {
      const quick = document.createElement("button");
      quick.type = "button";
      quick.className = "btn btn-quiet";
      quick.textContent = "Quick sell for " + value.toLocaleString() + " points";
      quick.addEventListener("click", () => quickSell(copy, value));
      foot.appendChild(quick);
    }
    return foot;
  }

  function visibleCards() {
    const rows = owned.filter((c) => !els.filterEvent.value || c.event === els.filterEvent.value);
    const sorts = {
      ovr: (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) ||
        a.player.localeCompare(b.player) ||
        a.user_card_id - b.user_card_id,
      newest: (a, b) => new Date(b.acquired_at) - new Date(a.acquired_at) || b.user_card_id - a.user_card_id,
      name: (a, b) => a.player.localeCompare(b.player) || (b.rating ?? 0) - (a.rating ?? 0),
    };
    return rows.sort(sorts[els.sort.value] || sorts.ovr);
  }

  function render() {
    const rows = visibleCards();
    const listed = owned.filter((c) => c.listing_id).length;
    els.filters.hidden = owned.length === 0;
    els.empty.hidden = owned.length > 0;
    els.summary.textContent = owned.length
      ? owned.length.toLocaleString() + " card" + (owned.length === 1 ? "" : "s") +
        (listed ? ", " + listed.toLocaleString() + " listed for sale." : ".")
      : "";

    els.cards.replaceChildren(
      ...rows.map((copy) => {
        const li = document.createElement("li");
        li.className = "item";
        li.append(window.NXTUP_buildCard(copy), buildFooter(copy));
        return li;
      })
    );
  }

  async function listCard(copy, price, hours) {
    setStatus("");
    if (!Number.isInteger(price) || price < copy.min_price) {
      setStatus("The price must be a whole number of at least " + copy.min_price.toLocaleString() + " points.");
      return;
    }
    if (
      !window.confirm(
        "List " + describe(copy) + " for " + price.toLocaleString() + " points for " +
          hours + (hours === 1 ? " hour" : " hours") + "? You cannot cancel a listing once it is placed."
      )
    )
      return;
    const { error } = await client.rpc("list_card", {
      p_user_card_id: copy.user_card_id,
      p_price: price,
      p_hours: hours,
    });
    setStatus(
      error
        ? "Could not list this card: " + error.message
        : "Listed " + copy.player + " for " + price.toLocaleString() + " points. It ends in " + hours + (hours === 1 ? " hour." : " hours.")
    );
    await load();
  }

  async function quickSell(copy, value) {
    if (!window.confirm("Quick sell " + describe(copy) + " for " + value.toLocaleString() + " points? This cannot be undone.")) return;
    setStatus("");
    const { data, error } = await client.rpc("quick_sell", { p_user_card_id: copy.user_card_id });
    setStatus(error ? "Could not quick sell: " + error.message : "Sold " + copy.player + " for " + Number(data).toLocaleString() + " points.");
    await load();
  }

  els.filterEvent.addEventListener("change", render);
  els.sort.addEventListener("change", render);

  await load();
}
