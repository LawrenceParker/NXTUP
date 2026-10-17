// My Collection: every card in the game, grouped into sections with a progress
// bar each. Sections are teams when the cards have teams, otherwise events.
// Inside a team the cards are grouped by event; inside an event, by role.
// Cards you have collected are shown in full; the rest are dimmed so you can
// see what is left to chase. A section shows COMPLETE at 100%.

const config = window.NXTUP_CONFIG || {};

const els = {
  status: document.getElementById("status"),
  overall: document.getElementById("overall"),
  overallCount: document.getElementById("overall-count"),
  overallPct: document.getElementById("overall-pct"),
  overallFill: document.getElementById("overall-fill"),
  overallTeams: document.getElementById("overall-teams"),
  filters: document.getElementById("filters"),
  teamFilter: document.getElementById("team-filter"),
  intro: document.getElementById("intro"),
  showFilter: document.getElementById("show-filter"),
  teams: document.getElementById("teams"),
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

const percent = (done, total) => (total ? Math.floor((done / total) * 100) : 0);

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

  // ---- load everything ---------------------------------------------------------

  const modeRes = await client.from("settings").select("value").eq("key", "collection_mode").maybeSingle();
  const mode = modeRes.data && modeRes.data.value === "currently_owned" ? "currently_owned" : "ever_owned";

  const cards = await fetchAll(() =>
    client
      .from("cards_with_rarity")
      .select("id, player, team, role, rating, attack, defence, rarity, rarity_color, rarity_order, region, event, event_label, event_style, event_order")
      .order("id", { ascending: true })
  );

  const stylesRes = await client.from("event_styles").select("style, color");
  const styleColor = new Map((stylesRes.data || []).map((r) => [r.style, r.color]));

  const collected = new Set();
  const ownedNow = () =>
    fetchAll(() => client.from("my_cards").select("card_id").order("user_card_id", { ascending: true }));

  if (mode === "currently_owned") {
    (await ownedNow()).forEach((r) => collected.add(r.card_id));
  } else {
    try {
      const rows = await fetchAll(() =>
        client.from("collection_entries").select("card_id").eq("user_id", userId).order("card_id", { ascending: true })
      );
      rows.forEach((r) => collected.add(r.card_id));
    } catch (err) {
      // 13_collection.sql has not been run yet: fall back to what is owned now.
      (await ownedNow()).forEach((r) => collected.add(r.card_id));
      setStatus("Collection tracking is not set up yet (13_collection.sql), so this shows the cards you own right now.");
    }
  }

  if (cards.length === 0) {
    els.empty.textContent = "No cards have been added to the game yet.";
    els.empty.hidden = false;
    return;
  }

  // ---- group the cards ------------------------------------------------------------
  // With team data: one section per team, cards grouped by event.
  // Without it:     one section per event, cards grouped by role.

  const pretty = (e) => window.NXTUP_prettyEvent(e) || "No event";
  const hasTeams = cards.filter((c) => c.team && c.team.trim()).length > cards.length / 2;

  const sectionName = (c) => (hasTeams ? (c.team && c.team.trim()) || "No team" : pretty(c.event));
  const sectionOrder = (c) => (hasTeams ? 0 : c.event_order ?? 999);
  const groupName = (c) => (hasTeams ? pretty(c.event) : c.role || "Other");
  const groupOrder = (c) => (hasTeams ? c.event_order ?? 999 : 0);
  const groupColor = (c) => (hasTeams ? styleColor.get(c.event_style) || null : null);

  const bySection = new Map();
  cards.forEach((c) => {
    const name = sectionName(c);
    if (!bySection.has(name)) bySection.set(name, { name, order: sectionOrder(c), list: [] });
    bySection.get(name).list.push(c);
  });

  const teams = [...bySection.values()]
    .map(({ name, order, list }) => {
      let region = "";
      if (hasTeams) {
        const counts = {};
        list.forEach((c) => c.region && (counts[c.region] = (counts[c.region] || 0) + 1));
        region = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "";
      }

      const groups = new Map();
      list.forEach((c) => {
        const gname = groupName(c);
        if (!groups.has(gname)) groups.set(gname, { rarity: gname, order: groupOrder(c), color: groupColor(c), cards: [] });
        groups.get(gname).cards.push(c);
      });
      const sortedGroups = [...groups.values()].sort((a, b) => a.order - b.order || String(a.rarity).localeCompare(String(b.rarity)));
      sortedGroups.forEach((g) => g.cards.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.player.localeCompare(b.player)));

      return { name, order, region, total: list.length, done: list.filter((c) => collected.has(c.id)).length, groups: sortedGroups };
    })
    .sort((a, b) => a.order - b.order || (a.name === "No team") - (b.name === "No team") || a.name.localeCompare(b.name));

  if (!hasTeams) {
    els.intro.textContent = "Every card you pack or buy is checked off here, event by event. Fill them all.";
    els.teamFilter.previousSibling.textContent = "Event ";
    els.teamFilter.options[0].text = "All events";
  }

  // ---- overall progress --------------------------------------------------------------

  const totalCards = cards.length;
  const doneCards = cards.filter((c) => collected.has(c.id)).length;
  const doneTeams = teams.filter((t) => t.total > 0 && t.done === t.total).length;

  els.overallCount.textContent = doneCards.toLocaleString() + " / " + totalCards.toLocaleString() + " cards";
  els.overallPct.textContent = percent(doneCards, totalCards) + "%";
  els.overallFill.style.width = percent(doneCards, totalCards) + "%";
  els.overallFill.classList.toggle("is-complete", doneCards === totalCards);
  els.overallFill.parentElement.setAttribute("aria-valuenow", String(percent(doneCards, totalCards)));
  const unit = hasTeams ? "team" : "event";
  els.overallTeams.textContent =
    doneTeams.toLocaleString() + " of " + teams.length.toLocaleString() + " " + unit + (teams.length === 1 ? "" : "s") + " complete.";
  els.overall.hidden = false;

  // ---- controls ---------------------------------------------------------------------------

  teams.forEach((t) => els.teamFilter.appendChild(new Option(t.name, t.name)));
  els.filters.hidden = false;

  const openTeams = new Set();

  // ---- drawing ----------------------------------------------------------------------------

  function fillTeam(body, team) {
    if (body.dataset.filled) return;
    body.dataset.filled = "1";
    const show = els.showFilter.value;

    team.groups.forEach((group) => {
      const shown = group.cards.filter((c) =>
        show === "all" ? true : show === "collected" ? collected.has(c.id) : !collected.has(c.id)
      );
      if (shown.length === 0) return;

      const doneInGroup = group.cards.filter((c) => collected.has(c.id)).length;
      const head = document.createElement("h4");
      head.className = "type-head";
      if (group.color) head.style.setProperty("--rarity", group.color);
      head.append(group.rarity || "Other");
      const count = document.createElement("span");
      count.className = "type-count";
      count.textContent = doneInGroup + " / " + group.cards.length;
      head.appendChild(count);

      const grid = document.createElement("ul");
      grid.className = "card-grid";
      shown.forEach((c) => {
        const li = document.createElement("li");
        if (!collected.has(c.id)) {
          li.className = "card-locked";
          li.title = "Not collected yet";
        }
        li.appendChild(window.NXTUP_buildCard(c));
        grid.appendChild(li);
      });
      body.append(head, grid);
    });
  }

  function buildTeam(team) {
    const details = document.createElement("details");
    details.className = "team";
    const complete = team.total > 0 && team.done === team.total;
    if (complete) details.classList.add("is-complete");

    const summary = document.createElement("summary");

    const name = document.createElement("div");
    name.className = "team-name";
    const nameText = document.createElement("span");
    nameText.className = "team-name-text";
    nameText.textContent = team.name;
    name.appendChild(nameText);
    if (team.region) {
      const region = document.createElement("span");
      region.className = "team-region";
      region.textContent = team.region;
      name.appendChild(region);
    }

    const bar = document.createElement("div");
    bar.className = "progress";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", team.name + " completion");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(percent(team.done, team.total)));
    const fill = document.createElement("div");
    fill.className = "progress-fill" + (complete ? " is-complete" : "");
    fill.style.width = percent(team.done, team.total) + "%";
    bar.appendChild(fill);

    const count = document.createElement("div");
    count.className = "team-count";
    if (complete) {
      const badge = document.createElement("span");
      badge.className = "team-complete";
      badge.textContent = "COMPLETE";
      count.appendChild(badge);
    }
    count.append(team.done + " / " + team.total);
    const pct = document.createElement("span");
    pct.className = "team-pct";
    pct.textContent = percent(team.done, team.total) + "%";
    count.appendChild(pct);

    summary.append(name, bar, count);

    const body = document.createElement("div");
    body.className = "team-body";
    details.append(summary, body);

    details.addEventListener("toggle", () => {
      if (details.open) {
        openTeams.add(team.name);
        fillTeam(body, team);
      } else {
        openTeams.delete(team.name);
      }
    });

    if (openTeams.has(team.name)) {
      details.open = true;
      fillTeam(body, team);
    }
    return details;
  }

  function render() {
    const show = els.showFilter.value;
    const chosen = els.teamFilter.value;
    if (chosen) openTeams.add(chosen);

    const list = teams.filter((t) => {
      if (chosen && t.name !== chosen) return false;
      if (show === "collected") return t.done > 0;
      if (show === "missing") return t.done < t.total;
      return true;
    });

    els.teams.replaceChildren(...list.map(buildTeam));
    els.empty.hidden = list.length > 0;
    els.empty.textContent =
      show === "missing" ? "Nothing missing here. Every card is collected." : "No cards to show for this filter yet.";
  }

  els.teamFilter.addEventListener("change", render);
  els.showFilter.addEventListener("change", render);

  render();
}
