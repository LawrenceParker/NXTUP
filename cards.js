// Shared by the packs, collection and marketplace pages.
//
// NXTUP_buildCard(card, { count }) returns one card element for a row with:
//   player, team, role, rating, image_url, rarity, rarity_color
//
// Every card is drawn as a shield: the player image clipped to the shield,
// a dark fade at the bottom, a coloured border, the category label top-left,
// and the player name and team near the bottom. The look of each category
// comes from its row in the rarities table:
//   color         border colour
//   color_2       optional second colour (the border becomes a gradient)
//   name_color    colour of the player name (white if blank)
//   template_url  optional frame image that replaces the drawn border, fade
//                 and label, for a category you want to design by hand
// The rarities table is read once; any cards drawn before it arrives are
// upgraded in place.

(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";

  // Border ring for the 718 x 818 shield: outer outline and a 12px inset.
  const RING =
    "M0 0 L718 0 L718 666 L523 818 L197 818 L0 666 Z " +
    "M12 12 L706 12 L706 660.1 L518.9 806 L201.1 806 L12 660.1 Z";

  const info = new Map(); // rarity name -> row from the rarities table
  const waiting = new Set(); // cards drawn before the table arrived
  let loaded = false;
  let gradientCount = 0;

  // Shrinks a long name so it always fits inside the card.
  const fitObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => entries.forEach((e) => e.target._fit && e.target._fit()))
      : null;

  function ring(color, color2) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "tpl-frame");
    svg.setAttribute("viewBox", "0 0 718 818");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");

    let fill = color;
    if (color2) {
      const id = "nxtup-grad-" + ++gradientCount;
      const defs = document.createElementNS(SVG_NS, "defs");
      const grad = document.createElementNS(SVG_NS, "linearGradient");
      grad.setAttribute("id", id);
      grad.setAttribute("x1", "0");
      grad.setAttribute("y1", "0");
      grad.setAttribute("x2", "1");
      grad.setAttribute("y2", "1");
      [[0, color], [1, color2]].forEach(([offset, stop]) => {
        const s = document.createElementNS(SVG_NS, "stop");
        s.setAttribute("offset", String(offset));
        s.setAttribute("stop-color", stop);
        grad.appendChild(s);
      });
      defs.appendChild(grad);
      svg.appendChild(defs);
      fill = "url(#" + id + ")";
    }

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", RING);
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("fill", fill);
    svg.appendChild(path);
    return svg;
  }

  function shieldCard(el, card, meta) {
    el.className = "card-tpl";

    const photo = document.createElement("img");
    photo.className = "tpl-photo";
    photo.alt = "";
    if (card.image_url) {
      photo.src = card.image_url;
      photo.loading = "lazy";
      photo.addEventListener("error", () => photo.remove());
    } else {
      photo.hidden = true;
    }
    el.appendChild(photo);

    if (meta.template_url) {
      // hand-designed frame image for this category
      const frame = document.createElement("img");
      frame.className = "tpl-frame";
      frame.src = meta.template_url;
      frame.alt = "";
      el.appendChild(frame);
    } else {
      const fade = document.createElement("div");
      fade.className = "tpl-fade";
      const label = document.createElement("span");
      label.className = "tpl-label";
      label.textContent = card.rarity || "";
      el.append(fade, ring(meta.color || card.rarity_color || "#939393", meta.color_2), label);
    }

    const name = document.createElement("span");
    name.className = "tpl-name";
    name.textContent = card.player;
    if (meta.name_color) name.style.color = meta.name_color;

    const team = document.createElement("span");
    team.className = "tpl-team";
    team.textContent = card.team || "";

    el.append(name, team);

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

    shieldCard(el, card, info.get(card.rarity) || {});
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

  // Read the category styles once.
  function load() {
    const client = window.NXTUP_client;
    if (!client) {
      loaded = true;
      return;
    }
    client
      .from("rarities")
      .select("name, color, color_2, name_color, template_url")
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
