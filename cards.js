// Shared by the packs, collection and marketplace pages.
//
// NXTUP_buildCard(card, { count }) returns one card element for a row with:
//   player, team, region, rarity (the card type), rarity_color
//
// Cards are drawn entirely in code as a shield, so no player photos or team
// logos are needed. The artwork is generated from the card itself: every
// player gets their own pattern, and the team's initials appear as a large
// watermark. The look of each card type comes from its row in the rarities
// table:
//   color         main colour (border, tag, artwork)
//   color_2       optional second colour (the border becomes a gradient)
//   name_color    colour of the player name (white if blank)
//   flair         0 to 3: extra detail. 0 clean, 1 inner line and side marks,
//                 2 adds a soft sheen, 3 adds light rays. Blank means 0.
//   template_url  optional full-card image you designed by hand; it replaces
//                 the generated artwork for that card type
// The rarities table is read once; cards drawn before it arrives are
// upgraded in place.

(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const INK = "#0b0e14";

  const SHIELD = "M0 0 L718 0 L718 666 L523 818 L197 818 L0 666 Z";
  const RING =
    SHIELD + " M12 12 L706 12 L706 660.1 L518.9 806 L201.1 806 L12 660.1 Z";
  const INNER_LINE = "M26 26 L692 26 L692 653.3 L514.1 792 L205.9 792 L26 653.2 Z";

  // Three emblem outlines; each card picks one from its seed.
  const CX = 359;
  const CY = 292;
  const EMBLEMS = [
    [[359, 92], [559, 292], [359, 492], [159, 292]], // diamond
    [[359, 87], [537, 189.5], [537, 394.5], [359, 497], [181, 394.5], [181, 189.5]], // hexagon
    [[169, 142], [509, 142], [549, 182], [549, 442], [209, 442], [169, 402]], // cut square
  ];

  const info = new Map(); // card type name -> row from the rarities table
  const waiting = new Set(); // cards drawn before the table arrived
  let loaded = false;
  let uidCount = 0;

  // Shrinks a long name so it always fits inside the card.
  const fitObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => entries.forEach((e) => e.target._fit && e.target._fit()))
      : null;

  // ---- small helpers --------------------------------------------------------

  function parseHex(c) {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(c || "").trim());
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function toHex(rgb) {
    return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  }

  // t = 0 gives a, t = 1 gives b
  function mix(a, b, t) {
    const x = parseHex(a) || [0, 0, 0];
    const y = parseHex(b) || [0, 0, 0];
    return toHex(x.map((v, i) => v + (y[i] - v) * t));
  }

  function validColor(c, fallback) {
    return parseHex(c) ? (String(c).trim().startsWith("#") ? String(c).trim() : "#" + String(c).trim()) : fallback;
  }

  // dark text on light colours, white text on dark ones
  function inkFor(hex) {
    const rgb = parseHex(hex) || [147, 147, 147];
    const luma = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    return luma > 0.5 ? INK : "#ffffff";
  }

  // The same card always gets the same random numbers.
  function seeded(text) {
    let h = 1779033703 ^ text.length;
    for (let i = 0; i < text.length; i++) {
      h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = (Math.imul(h ^ (h >>> 16), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // "NRG" stays NRG, "Fnatic" stays FNATIC, "Team Vitality" becomes TV,
  // "Gen.G" becomes GG, and a long single word is cut to 4 letters.
  function monogram(team) {
    const t = String(team || "").trim();
    if (!t) return "";
    const words = t.split(/[\s._-]+/).filter(Boolean);
    if (words.length >= 2) return words.slice(0, 4).map((w) => w[0]).join("").toUpperCase();
    return (t.length <= 6 ? t : t.slice(0, 4)).toUpperCase();
  }

  function el(name, attrs, parent) {
    const node = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach((k) => node.setAttribute(k, String(attrs[k])));
    if (parent) parent.appendChild(node);
    return node;
  }

  const points = (pts) => pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");

  function stop(parent, offset, color, opacity) {
    el("stop", { offset, "stop-color": color, "stop-opacity": opacity == null ? 1 : opacity }, parent);
  }

  // ---- the artwork ----------------------------------------------------------

  function buildArt(card, meta, color, color2, flair) {
    const uid = "nxtup-" + ++uidCount;
    const rnd = seeded([card.player, card.team, card.rarity].join("|"));
    const range = (lo, hi) => lo + rnd() * (hi - lo);
    const accent2 = color2 || color;

    const svg = el("svg", {
      class: "tpl-art",
      viewBox: "0 0 718 818",
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    });

    // gradients, pattern and the shield-shaped clip
    const defs = el("defs", {}, svg);
    const clip = el("clipPath", { id: uid + "-clip" }, defs);
    el("path", { d: SHIELD }, clip);

    const bg = el("linearGradient", { id: uid + "-bg", x1: 0, y1: 0, x2: 0.35, y2: 1 }, defs);
    stop(bg, 0, mix(INK, color, 0.3));
    stop(bg, 1, mix(INK, color, 0.05));

    const glow = el("radialGradient", { id: uid + "-glow", cx: 0.5, cy: 0.36, r: 0.46 }, defs);
    stop(glow, 0, color, 0.34);
    stop(glow, 1, color, 0);

    const fade = el("linearGradient", { id: uid + "-fade", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    stop(fade, 0.5, "#000", 0);
    stop(fade, 1, "#000", 0.9);

    const hatch = el(
      "pattern",
      { id: uid + "-hatch", width: 16, height: 16, patternUnits: "userSpaceOnUse", patternTransform: "rotate(35)" },
      defs
    );
    el("line", { x1: 0, y1: 0, x2: 0, y2: 16, stroke: color, "stroke-opacity": 0.13, "stroke-width": 2 }, hatch);

    const ringFill = color2 ? uid + "-edge" : null;
    if (ringFill) {
      const edge = el("linearGradient", { id: ringFill, x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
      stop(edge, 0, color);
      stop(edge, 1, color2);
    }

    const g = el("g", { "clip-path": "url(#" + uid + "-clip)" }, svg);

    el("rect", { width: 718, height: 818, fill: "url(#" + uid + "-bg)" }, g);
    el("rect", { width: 718, height: 560, fill: "url(#" + uid + "-hatch)" }, g);

    // diagonal slashes, different for every card
    for (let i = 0; i < 3; i++) {
      const x0 = range(-40, 520);
      const w = range(60, 190);
      const skew = range(240, 380);
      el(
        "polygon",
        {
          points: points([[x0, 0], [x0 + w, 0], [x0 + w - skew, 720], [x0 - skew, 720]]),
          fill: i === 1 ? accent2 : color,
          "fill-opacity": range(0.07, 0.2).toFixed(3),
        },
        g
      );
    }

    el("rect", { width: 718, height: 600, fill: "url(#" + uid + "-glow)" }, g);

    // light rays behind the emblem (flair 3)
    if (flair >= 3) {
      const rays = el("g", { stroke: color, "stroke-opacity": 0.16, "stroke-width": 2 }, g);
      for (let k = 0; k < 18; k++) {
        const a = (k * Math.PI * 2) / 18 + range(-0.02, 0.02);
        el("line", { x1: CX, y1: CY, x2: CX + Math.cos(a) * 900, y2: CY + Math.sin(a) * 900 }, rays);
      }
    }

    // team initials as a large watermark
    const mono = monogram(card.team);
    if (mono) {
      const size = Math.max(130, Math.min(300, 380 / (mono.length * 0.45)));
      const text = el(
        "text",
        {
          x: CX,
          y: CY + size * 0.04,
          "text-anchor": "middle",
          "dominant-baseline": "central",
          "font-family": '"Barlow Condensed", "Arial Narrow", sans-serif',
          "font-weight": 700,
          "font-size": size,
          fill: color,
          "fill-opacity": 0.1,
          stroke: color,
          "stroke-opacity": 0.35,
          "stroke-width": 2,
        },
        g
      );
      text.textContent = mono;
    }

    // emblem: one outline, picked per card, drawn twice
    const shape = EMBLEMS[Math.floor(rnd() * EMBLEMS.length)];
    el("polygon", { points: points(shape), fill: "none", stroke: color, "stroke-opacity": 0.75, "stroke-width": 3, "stroke-linejoin": "round" }, g);
    const inner = shape.map(([x, y]) => [CX + (x - CX) * 0.78, CY + (y - CY) * 0.78]);
    el("polygon", { points: points(inner), fill: color, "fill-opacity": 0.07, stroke: accent2, "stroke-opacity": 0.4, "stroke-width": 2, "stroke-linejoin": "round" }, g);

    // soft diagonal sheen (flair 2 and up)
    if (flair >= 2) {
      const sheen = el("linearGradient", { id: uid + "-sheen", x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
      stop(sheen, 0, "#fff", 0);
      stop(sheen, 0.5, "#fff", 0.1);
      stop(sheen, 1, "#fff", 0);
      el("polygon", { points: points([[330, 0], [520, 0], [150, 818], [-40, 818]]), fill: "url(#" + uid + "-sheen)" }, g);
    }

    // dark fade so the name is always readable
    el("rect", { width: 718, height: 818, fill: "url(#" + uid + "-fade)" }, g);

    // short slanted bar above the name
    el("polygon", { points: points([[259, 592], [281, 580], [437, 580], [459, 592]]), fill: color }, g);

    // inner line and side marks (flair 1 and up)
    if (flair >= 1) {
      el("path", { d: INNER_LINE, fill: "none", stroke: color, "stroke-opacity": 0.4, "stroke-width": 2 }, g);
      [[26, 340], [692, 340]].forEach(([x, y]) => {
        el("polygon", { points: points([[x, y - 11], [x + 11, y], [x, y + 11], [x - 11, y]]), fill: color }, g);
      });
    }

    // border on top
    el("path", { d: RING, "fill-rule": "evenodd", fill: ringFill ? "url(#" + ringFill + ")" : color }, svg);

    return svg;
  }

  // ---- the card --------------------------------------------------------------

  function shieldCard(el_, card, meta) {
    el_.className = "card-tpl";

    const color = validColor(meta.color || card.rarity_color, "#939393");
    const color2 = meta.color_2 ? validColor(meta.color_2, null) : null;
    const flair = Math.max(0, Math.min(3, parseInt(meta.flair, 10) || 0));

    if (meta.template_url) {
      const img = document.createElement("img");
      img.className = "tpl-art";
      img.src = meta.template_url;
      img.alt = "";
      el_.appendChild(img);
    } else {
      el_.appendChild(buildArt(card, meta, color, color2, flair));
    }

    // card type tag, top-left
    const label = document.createElement("span");
    label.className = "tpl-label";
    label.textContent = card.rarity || "";
    label.style.setProperty("--chip", color);
    label.style.setProperty("--chip-ink", inkFor(color));
    el_.appendChild(label);

    // region, top-right
    if (card.region) {
      const region = document.createElement("span");
      region.className = "tpl-region";
      region.textContent = card.region;
      region.style.setProperty("--chip", color);
      el_.appendChild(region);
    }

    const name = document.createElement("span");
    name.className = "tpl-name";
    name.textContent = card.player;
    if (meta.name_color) name.style.color = meta.name_color;

    const team = document.createElement("span");
    team.className = "tpl-team";
    team.textContent = card.team || "";

    el_.append(name, team);

    // Long names shrink to fit; short ones keep the full size.
    el_._fit = function () {
      const limit = el_.clientWidth * 0.84;
      [name, team].forEach((span) => {
        span.style.setProperty("--fit", "1");
        const natural = span.scrollWidth;
        if (natural > 0 && limit > 0 && natural > limit) {
          span.style.setProperty("--fit", String(limit / natural));
        }
      });
    };
    if (fitObserver) fitObserver.observe(el_);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => el_._fit && el_._fit());
  }

  function render(node) {
    const card = node._card;
    const opts = node._opts;
    if (fitObserver) fitObserver.unobserve(node);
    node._fit = null;
    node.replaceChildren();

    shieldCard(node, card, info.get(card.rarity) || {});
    node.setAttribute(
      "aria-label",
      [card.player, card.team, card.region, card.rarity].filter(Boolean).join(", ")
    );

    if (opts.count && opts.count > 1) {
      const badge = document.createElement("span");
      badge.className = "card-count";
      badge.textContent = "x" + opts.count;
      node.appendChild(badge);
    }
  }

  window.NXTUP_buildCard = function (card, options) {
    const node = document.createElement("article");
    node._card = card;
    node._opts = options || {};
    render(node);
    if (!loaded) waiting.add(node);
    return node;
  };

  // Read the card type styles once.
  function load() {
    const client = window.NXTUP_client;
    if (!client) {
      loaded = true;
      return;
    }
    client
      .from("rarities")
      .select("name, color, color_2, name_color, flair, template_url")
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
