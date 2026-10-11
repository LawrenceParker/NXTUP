// Home page: sign in button and welcome line. The navbar (nav.js) handles
// points, avatar and sign out on every page.

const els = {
  signedOut: document.getElementById("signed-out"),
  signedIn: document.getElementById("signed-in"),
  signIn: document.getElementById("signin"),
  name: document.getElementById("name"),
  status: document.getElementById("status"),
};

function setStatus(message) {
  els.status.textContent = message || "";
}

const client = window.NXTUP_client;

if (!client) {
  setStatus(
    window.supabase
      ? "Add your Supabase URL and anon key to config.js, then reload."
      : "The Supabase library did not load. Check your connection, or turn off any ad blocker for this site, then reload."
  );
} else {
  els.signIn.addEventListener("click", () => {
    setStatus("");
    window.NXTUP.signIn(setStatus);
  });

  async function render(session) {
    if (!session || !session.user) {
      els.signedIn.hidden = true;
      els.signedOut.hidden = false;
      return;
    }
    els.signedOut.hidden = true;
    els.signedIn.hidden = false;

    const { data } = await client
      .from("profiles")
      .select("display_name")
      .eq("id", session.user.id)
      .single();

    if (data) {
      els.name.textContent = data.display_name;
      setStatus("");
    } else {
      els.name.textContent = "player";
      setStatus("Signed in, but your profile could not be loaded. Check that 01_schema.sql ran without errors.");
    }
  }

  client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => render(session), 0);
  });
  client.auth.getSession().then(({ data }) => render(data.session));
}
