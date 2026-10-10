const config = window.NXTUP_CONFIG || {};

const els = {
  signedOut: document.getElementById("signed-out"),
  signedIn: document.getElementById("signed-in"),
  signIn: document.getElementById("signin"),
  signOut: document.getElementById("signout"),
  avatar: document.getElementById("avatar"),
  name: document.getElementById("name"),
  points: document.getElementById("points"),
  status: document.getElementById("status"),
};

function setStatus(message) {
  els.status.textContent = message || "";
}

const configMissing =
  !config.SUPABASE_URL ||
  !config.SUPABASE_ANON_KEY ||
  config.SUPABASE_URL.startsWith("PASTE") ||
  config.SUPABASE_ANON_KEY.startsWith("PASTE");

if (configMissing) {
  setStatus("Add your Supabase URL and anon key to config.js, then reload.");
} else {
  start();
}

function start() {
  const client = window.supabase.createClient(
    config.SUPABASE_URL,
    config.SUPABASE_ANON_KEY
  );

  async function showSignedIn(user) {
    els.signedOut.hidden = true;
    els.signedIn.hidden = false;

    const { data, error } = await client
      .from("profiles")
      .select("display_name, avatar_url, points")
      .eq("id", user.id)
      .single();

    if (error || !data) {
      setStatus("Signed in, but your profile could not be loaded. Check that 01_schema.sql ran without errors.");
      els.name.textContent = "Signed in";
      return;
    }

    setStatus("");
    els.name.textContent = data.display_name;
    els.points.textContent = data.points.toLocaleString();
    if (data.avatar_url) {
      els.avatar.src = data.avatar_url;
    }
  }

  function showSignedOut() {
    els.signedIn.hidden = true;
    els.signedOut.hidden = false;
  }

  function render(session) {
    if (session && session.user) {
      showSignedIn(session.user);
    } else {
      showSignedOut();
    }
  }

  els.signIn.addEventListener("click", async () => {
    setStatus("");
    const { error } = await client.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) setStatus("Discord sign-in failed: " + error.message);
  });

  els.signOut.addEventListener("click", async () => {
    await client.auth.signOut();
  });

  // Defer the render so Supabase finishes its own auth update first.
  client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => render(session), 0);
  });

  client.auth.getSession().then(({ data }) => render(data.session));
}
