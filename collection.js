const config = window.NXTUP_CONFIG || {};

const els = {
  status: document.getElementById("status"),
  points: document.getElementById("points"),
  summary: document.getElementById("summary"),
  collection: document.getElementById("collection"),
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
    setStatusWithLink("Sign in with Discord to see your collection.", "index.html", "Go to sign in");
    return;
  }
  const userId = sessionData.session.user.id;

  let owned = [];
  let quickSellPercent = null;
  let durations = [1];
  let defaultHours = 1;

  async function load() {
    const [profileRes, cardsRes, settingsRes] = await Promise.all([
      client.from("profiles").select("points").eq("id", userId).single(),
      client.from("my_cards").select("*"),
      client
        .from("settings")
        .select("key, value")
        .in("key", ["quick_sell_percent", "listing_durations_hours", "default_listing_hours"]),
    ]);

    if (profileRes.data) els.points.textContent = profileRes.data.points.toLocaleString();
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

    if (cardsRes.error) {
      setStatus("Could not load your cards: " + cardsRes.error.message);
      return;
    }
    owned = cardsRes.data || [];
    render();
  }

  function quickSellValue(card) {
    if (quickSellPercent == null || !card.min_price) return null;
    return Math.round((card.min_price * quickSellPercent) / 100);
  }

  function buildFooter(group) {
    const foot = document.createElement("div");
    foot.className = "item-foot";
    const card = group.card;
    const unlisted = group.copies.filter((c) => !c.listing_id);
    const listed = group.copies.filter((c) => c.listing_id);

    if (unlisted.length > 0 && card.min_price > 0) {
      const sub = document.createElement("p");
      sub.className = "price-sub";
      sub.textContent = "Minimum price: " + card.min_price.toLocaleString() + " points";

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
      input.min = card.min_price;
      input.step = 1;
      input.value = card.min_price;
      field.appendChild(input);

      const listBtn = document.createElement("button");
      listBtn.type = "button";
      listBtn.className = "btn btn-primary";
      listBtn.textContent = "List";
      listBtn.addEventListener("click", () => listCard(unlisted[0], Number(input.value), hours));

      row.append(field, listBtn);
      foot.append(sub, tabs, row);

      const value = quickSellValue(card);
      if (value != null) {
        const quick = document.createElement("button");
        quick.type = "button";
        quick.className = "btn btn-quiet";
        quick.textContent = "Quick sell for " + value.toLocaleString() + " points";
        quick.addEventListener("click", () => quickSell(unlisted[0], value));
        foot.appendChild(quick);
      }
    } else if (unlisted.length > 0) {
      const note = document.createElement("p");
      note.className = "price-sub";
      note.textContent = "No minimum price is set for this rarity yet.";
      foot.appendChild(note);
    }

    listed.forEach((copy) => {
      const line = document.createElement("p");
      line.className = "price";
      line.textContent = "Listed for " + copy.listing_price.toLocaleString() + " points";
      const left = document.createElement("p");
      left.className = "price-sub";
      left.textContent = "Ends in " + formatRemaining(copy.listing_expires_at);
      foot.append(line, left);
    });

    return foot;
  }

  function render() {
    if (owned.length === 0) {
      els.summary.textContent = "You do not own any cards yet.";
      els.collection.replaceChildren();
      return;
    }

    const grouped = new Map();
    for (const row of owned) {
      const entry = grouped.get(row.card_id);
      if (entry) entry.copies.push(row);
      else grouped.set(row.card_id, { card: row, copies: [row] });
    }

    const groups = [...grouped.values()].sort(
      (a, b) =>
        (b.card.rarity_order ?? 0) - (a.card.rarity_order ?? 0) ||
        (b.card.rating ?? 0) - (a.card.rating ?? 0) ||
        a.card.player.localeCompare(b.card.player)
    );

    els.summary.textContent =
      owned.length.toLocaleString() + " cards, " + groups.length.toLocaleString() + " different.";

    els.collection.replaceChildren(
      ...groups.map((group) => {
        const li = document.createElement("li");
        li.className = "item";
        li.append(
          window.NXTUP_buildCard(group.card, { count: group.copies.length }),
          buildFooter(group)
        );
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
    if (!window.confirm("List " + copy.player + " for " + price.toLocaleString() + " points for " + hours + (hours === 1 ? " hour" : " hours") + "? You cannot cancel a listing once it is placed.")) return;
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
    if (!window.confirm("Quick sell " + copy.player + " (" + copy.rarity + ") for " + value.toLocaleString() + " points? This cannot be undone.")) return;
    setStatus("");
    const { data, error } = await client.rpc("quick_sell", { p_user_card_id: copy.user_card_id });
    setStatus(error ? "Could not quick sell: " + error.message : "Sold " + copy.player + " for " + Number(data).toLocaleString() + " points.");
    await load();
  }

  await load();
}
