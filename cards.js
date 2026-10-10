// Shared by packs.js and collection.js.
// Builds one card element from a row with: player, team, role, rating,
// image_url, rarity, rarity_color. Pass { count } to show a duplicate badge.
window.NXTUP_buildCard = function (card, options) {
  const opts = options || {};

  const el = document.createElement("article");
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

  if (opts.count && opts.count > 1) {
    const badge = document.createElement("span");
    badge.className = "card-count";
    badge.textContent = "x" + opts.count;
    el.appendChild(badge);
  }

  return el;
};
