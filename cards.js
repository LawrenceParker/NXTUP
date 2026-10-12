// Shared by the packs, collection and marketplace pages.
//
// NXTUP_buildCard(card, { count }) returns one card element for a row with:
//   player, team, role, rating, image_url, rarity, rarity_color
//
// If the card's category (its "rarity") has a template_url in the rarities
// table, the card is drawn from that template: the player image sits behind
// the frame, with the name and team written on top. Categories without a
// template keep the plain card look. Templates are read from the rarities
// table once, and any cards drawn before they arrive are upgraded in place.

(function () {
  const info = new Map(); // rarity name -> { template_url, name_color }
  const waiting = new Set(); // cards drawn before the templates arrived
  let loaded = false;

  // Shrinks a long name so it always fits inside the card.
  const fitObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => entries.forEach((e) => e.target._fit && e.target._fit()))
      : null;

  function plainCard(el, card) {
    el.className = "card";
    if (card.rarity_color) el.style.setProperty("--rarity", card.rarity_color);

    if (card.image_url) {
      const img = document.createElement("img");
      img.className = "card-image";
      img.src = card.image_url;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => {
        const blank = document.createElement("div");
        blank.className = "card-image-empty";
        img.replaceWith(blank);
      });
      el.appendChild(img);
    } else {
      const blank = document.createElement("div");
      blank.className = "card-image-empty";
      el.appendChild(blank);
    }

    const rating = document.createElement("span");
    rating.className = "card-rating";
    rating.textContent = card.rating == null ? "" : card.rating;
    el.appendChild(rating);

    const name = document.createElement("p");
    name.className = "card-name";
    name.textContent = card.player;
    el.appendChild(name);

    const meta = document.createElement("p");
    meta.className = "card-meta";
    meta.textContent = [card.team, card.role].filter(Boolean).join(", ");
    el.appendChild(meta);

    const rarity = document.createElement("p");
    rarity.className = "card-rarity";
    rarity.textContent = card.rarity;
    el.appendChild(rarity);
  }

  function templatedCard(el, card, tpl) {
    el.className = "card-tpl";
    el.style.removeProperty("--rarity");

    const photo = document.createElement("img");
    photo.className = "tpl-photo";
    if (card.image_url) {
      photo.src = card.image_url;
      photo.loading = "lazy";
      photo.addEventListener("error", () => photo.remove());
    } else {
      photo.hidden = true;
    }
    photo.alt = "";

    const frame = document.createElement("img");
    frame.className = "tpl-frame";
    frame.src = tpl.template_url;
    frame.alt = "";

    const name = document.createElement("span");
    name.className = "tpl-name";
    name.textContent = card.player;
    if (tpl.name_color) name.style.color = tpl.name_color;

    const team = document.createElement("span");
    team.className = "tpl-team";
    team.textContent = card.team || "";

    el.append(photo, frame, name, team);

    // Long names shrink to fit; short ones keep the full size.
    el._fit = function () {
      const limit = el.clientWidth * 0.84;
      [name, team].forEach((span) => {
        span.style.setProperty("--fit", "1");
        const natural = span.scrollWidth;
        if (natural > 0 && limit > 0 && natural > limit) {
          span.style.setProperty("--fit", String(limit / natural));
        }
      });
    };
    if (fitObserver) fitObserver.observe(el);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => el._fit && el._fit());
  }

  function render(el) {
    const card = el._card;
    const opts = el._opts;
    if (fitObserver) fitObserver.unobserve(el);
    el._fit = null;
    el.replaceChildren();

    const tpl = info.get(card.rarity);
    if (tpl && tpl.template_url) templatedCard(el, card, tpl);
    else plainCard(el, card);

    el.setAttribute("aria-label", [card.player, card.team, card.rarity].filter(Boolean).join(", "));

    if (opts.count && opts.count > 1) {
      const badge = document.createElement("span");
      badge.className = "card-count";
      badge.textContent = "x" + opts.count;
      el.appendChild(badge);
    }
  }

  window.NXTUP_buildCard = function (card, options) {
    const el = document.createElement("article");
    el._card = card;
    el._opts = options || {};
    render(el);
    if (!loaded) waiting.add(el);
    return el;
  };

  // Read the category templates once.
  function load() {
    const client = window.NXTUP_client;
    if (!client) {
      loaded = true;
      return;
    }
    client
      .from("rarities")
      .select("name, template_url, name_color")
      .then(({ data, error }) => {
        if (!error && data) data.forEach((r) => info.set(r.name, r));
        loaded = true;
        waiting.forEach(render);
        waiting.clear();
      })
      .catch(() => {
        loaded = true;
        waiting.clear();
      });
  }
  load();
})();
