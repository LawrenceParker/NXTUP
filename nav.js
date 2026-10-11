// NXTUP navbar. Loaded on every page after config.js.
// - Builds the top navigation bar.
// - Creates the one Supabase connection every page shares (window.NXTUP_client).
// - Shows the player's points and avatar, plus sign in / sign out.
// To add or rename a page link, edit the LINKS list below.

(function () {
  const LINKS = [
    { href: "index.html", label: "Home" },
    { href: "predictions.html", label: "Predictions" },
    { href: "packs.html", label: "Packs" },
    { href: "collection.html", label: "Collection" },
    { href: "market.html", label: "Marketplace" },
  ];

  const config = window.NXTUP_CONFIG || {};
  const configured =
    window.supabase &&
    config.SUPABASE_URL &&
    config.SUPABASE_ANON_KEY &&
    !String(config.SUPABASE_URL).startsWith("PASTE") &&
    !String(config.SUPABASE_ANON_KEY).startsWith("PASTE");

  const client = configured
    ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY)
    : null;
  window.NXTUP_client = client;

  // Sign in with Discord and come back to the site's home page.
  async function signIn(onError) {
    if (!client) return;
    const { error } = await client.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: new URL("./", window.location.href).href },
    });
    if (error && onError) onError("Discord sign-in failed: " + error.message);
  }
  window.NXTUP = { signIn };

  // ---- build the bar ----------------------------------------------------

  const current = window.location.pathname.split("/").pop() || "index.html";

  const header = document.createElement("header");
  header.className = "site-nav";

  const inner = document.createElement("div");
  inner.className = "site-nav-inner";

  const brand = document.createElement("a");
  brand.className = "nav-brand";
  brand.href = "index.html";
  brand.textContent = "NXTUP";

  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "Main");
  nav.style.display = "contents";
  const list = document.createElement("ul");
  list.className = "nav-links";
  LINKS.forEach((link) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = link.href;
    a.textContent = link.label;
    if (link.href === current) a.setAttribute("aria-current", "page");
    li.appendChild(a);
    list.appendChild(li);
  });
  nav.appendChild(list);

  const user = document.createElement("div");
  user.className = "nav-user";

  const signInBtn = document.createElement("button");
  signInBtn.type = "button";
  signInBtn.className = "btn btn-discord btn-small";
  signInBtn.textContent = "Sign in";
  signInBtn.hidden = true;
  signInBtn.addEventListener("click", () => signIn());

  const account = document.createElement("div");
  account.className = "nav-account";
  account.hidden = true;

  const pointsChip = document.createElement("span");
  pointsChip.className = "nav-points";
  const pointsValue = document.createElement("span");
  pointsValue.id = "points"; // pages update this number
  pointsValue.textContent = "0";
  pointsChip.append(pointsValue, " pts");

  const avatar = document.createElement("img");
  avatar.className = "nav-avatar";
  avatar.alt = "";
  avatar.width = 32;
  avatar.height = 32;
  avatar.hidden = true;

  const signOutBtn = document.createElement("button");
  signOutBtn.type = "button";
  signOutBtn.className = "btn btn-quiet btn-small";
  signOutBtn.textContent = "Sign out";
  signOutBtn.addEventListener("click", async () => {
    if (client) await client.auth.signOut();
    window.location.href = "index.html";
  });

  account.append(pointsChip, avatar, signOutBtn);
  user.append(signInBtn, account);

  inner.append(brand, nav, user);
  header.appendChild(inner);
  document.body.prepend(header);

  // ---- show the right state ------------------------------------------------

  async function render(session) {
    if (!client) return;
    if (!session || !session.user) {
      account.hidden = true;
      signInBtn.hidden = false;
      return;
    }
    signInBtn.hidden = true;
    account.hidden = false;

    const { data } = await client
      .from("profiles")
      .select("display_name, avatar_url, points")
      .eq("id", session.user.id)
      .single();

    if (data) {
      pointsValue.textContent = data.points.toLocaleString();
      if (data.avatar_url) {
        avatar.src = data.avatar_url;
        avatar.title = data.display_name;
        avatar.hidden = false;
      }
    }
  }

  if (client) {
    client.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => render(session), 0);
    });
    client.auth.getSession().then(({ data }) => render(data.session));
  }
})();
