const config = window.NXTUP_CONFIG || {};

const els = {
  status: document.getElementById("status"),
  points: document.getElementById("points"),
  upcomingSection: document.getElementById("upcoming-section"),
  upcoming: document.getElementById("upcoming"),
  resultsSection: document.getElementById("results-section"),
  results: document.getElementById("results"),
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
  const client = window.NXTUP_client || window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

  const { data: sessionData } = await client.auth.getSession();
  const session = sessionData.session;
  if (!session) {
    setStatusWithLink("Sign in with Discord to make predictions.", "index.html", "Go to sign in");
    return;
  }
  const userId = session.user.id;

  const [profileRes, matchesRes, picksRes, settingsRes] = await Promise.all([
    client.from("profiles").select("points").eq("id", userId).single(),
    client
      .from("matches")
      .select("id, event, stage, team_a, team_b, starts_at, winner, status, reward")
      .neq("status", "cancelled")
      .order("starts_at", { ascending: true }),
    client
      .from("predictions")
      .select("match_id, pick, correct, points_awarded, settled")
      .eq("user_id", userId),
    client.from("settings").select("value").eq("key", "points_per_correct_pick").maybeSingle(),
  ]);

  if (matchesRes.error) {
    setStatus("Could not load matches: " + matchesRes.error.message);
    return;
  }

  if (profileRes.data) els.points.textContent = profileRes.data.points.toLocaleString();

  const matches = matchesRes.data || [];
  const picks = new Map((picksRes.data || []).map((p) => [p.match_id, p]));

  const defaultReward = settingsRes.data ? Number(settingsRes.data.value) : null;

  // A match's own reward, or the default from settings when it has none.
  function rewardFor(match) {
    return match.reward != null ? match.reward : defaultReward;
  }

  function isOpen(match) {
    return match.status === "upcoming" && new Date(match.starts_at) > new Date();
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleString([], {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function teamButton(match, side, pick, open) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "team";
    const name = document.createElement("span");
    name.className = "team-name";
    name.textContent = side === "a" ? match.team_a : match.team_b;
    btn.appendChild(name);

    const picked = Boolean(pick) && pick.pick === side;
    btn.setAttribute("aria-pressed", picked ? "true" : "false");
    btn.disabled = !open;

    // Once a result is in: winner green, loser red.
    if (match.winner) btn.classList.add(match.winner === side ? "is-winner" : "is-loser");

    if (picked) {
      const tag = document.createElement("span");
      tag.className = "pick-tag";
      tag.textContent = open ? "Selected" : "Your pick";
      btn.appendChild(tag);
    }

    if (open) btn.addEventListener("click", () => savePick(match, side));
    return btn;
  }

  function noteFor(match, pick, open) {
    const note = document.createElement("p");
    note.className = "match-note";
    if (open) {
      const reward = rewardFor(match);
      const earn = reward != null ? " A correct pick earns " + reward.toLocaleString() + " points." : "";
      note.textContent = (pick ? "Your pick is saved." : "No pick yet.") + earn;
    } else if (!match.winner) {
      note.textContent = pick ? "Picks are locked. Waiting for the result." : "Picks are locked. You did not pick.";
    } else if (!pick) {
      note.textContent = "You did not pick.";
    } else if (pick.correct) {
      note.textContent = "Correct. +" + pick.points_awarded.toLocaleString() + " points.";
      note.classList.add("is-correct");
    } else if (pick.settled) {
      note.textContent = "Wrong pick. No points.";
      note.classList.add("is-wrong");
    } else {
      note.textContent = "Result recorded. Points are being added.";
    }
    return note;
  }

  function buildMatch(match) {
    const open = isOpen(match);
    const pick = picks.get(match.id);

    const li = document.createElement("li");
    li.className = "match";
    li.dataset.matchId = match.id;

    const meta = document.createElement("p");
    meta.className = "match-meta";
    const eventEl = document.createElement("span");
    eventEl.textContent = match.stage ? match.event + ", " + match.stage : match.event;
    const timeEl = document.createElement("span");
    timeEl.textContent = formatTime(match.starts_at);
    meta.append(eventEl, timeEl);

    const teams = document.createElement("div");
    teams.className = "match-teams";
    const vs = document.createElement("span");
    vs.className = "match-vs";
    vs.textContent = "vs";
    teams.append(teamButton(match, "a", pick, open), vs, teamButton(match, "b", pick, open));

    li.append(meta, teams, noteFor(match, pick, open));
    return li;
  }

  function render() {
    const upcoming = matches.filter(isOpen);
    const past = matches.filter((m) => !isOpen(m)).reverse();

    els.upcoming.replaceChildren(...upcoming.map(buildMatch));
    els.results.replaceChildren(...past.map(buildMatch));

    els.upcomingSection.hidden = false;
    els.resultsSection.hidden = past.length === 0;

    if (upcoming.length === 0) {
      const empty = document.createElement("li");
      empty.className = "section-note";
      empty.textContent = "No upcoming matches right now. Check back soon.";
      els.upcoming.appendChild(empty);
    }
  }

  async function savePick(match, side) {
    setStatus("");
    const existing = picks.get(match.id);

    let error;
    if (existing) {
      ({ error } = await client
        .from("predictions")
        .update({ pick: side })
        .eq("user_id", userId)
        .eq("match_id", match.id));
    } else {
      ({ error } = await client
        .from("predictions")
        .insert({ user_id: userId, match_id: match.id, pick: side }));
    }

    if (error) {
      setStatus("Could not save your pick. The match may have just started. (" + error.message + ")");
      return;
    }

    picks.set(match.id, { ...(existing || {}), match_id: match.id, pick: side });
    render();
  }

  render();
}
