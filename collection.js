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

if (!window.supabase || !config.SUPABASE_URL || config.SUPABASE_URL.startsWith("PASTE")) {
  setStatus("Supabase is not set up. Check config.js.");
} else {
  start().catch((err) => setStatus("Something went wrong: " + err.message));
}

async function start() {
  const client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    setStatusWithLink("Sign in with Discord to see your collection.", "index.html", "Go to sign in");
    return;
  }
  const userId = sessionData.session.user.id;

  const [profileRes, cardsRes] = await Promise.all([
    client.from("profiles").select("points").eq("id", userId).single(),
    client.from("my_cards").select("*"),
  ]);

  if (profileRes.data) els.points.textContent = profileRes.data.points.toLocaleString();

  if (cardsRes.error) {
    setStatus("Could not load your cards: " + cardsRes.error.message);
    return;
  }

  const owned = cardsRes.data || [];
  if (owned.length === 0) {
    els.summary.textContent = "You do not own any cards yet.";
    return;
  }

  // Group copies of the same card together.
  const grouped = new Map();
  for (const row of owned) {
    const entry = grouped.get(row.card_id);
    if (entry) entry.count += 1;
    else grouped.set(row.card_id, { card: row, count: 1 });
  }

  // Highest rarity first, then highest rating, then name.
  const entries = [...grouped.values()].sort(
    (a, b) =>
      b.card.rarity_order - a.card.rarity_order ||
      b.card.rating - a.card.rating ||
      a.card.player.localeCompare(b.card.player)
  );

  els.summary.textContent =
    owned.length.toLocaleString() + " cards, " + entries.length.toLocaleString() + " different.";

  els.collection.replaceChildren(
    ...entries.map(({ card, count }) => {
      const li = document.createElement("li");
      li.appendChild(window.NXTUP_buildCard(card, { count }));
      return li;
    })
  );
}
