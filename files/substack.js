/* ------------------------------------------------------------------
   hackers.bio — latest Substack posts
   Runs on Cloudflare, not in the browser, so there's no CORS problem
   and no third-party service in the middle.

   Feed for hackers.bio (Sergi). Change FEED only if the publication
   ever moves to a custom domain.
------------------------------------------------------------------- */
const FEED = "https://hackersbio.substack.com/feed";
const HOW_MANY = 3;
const SUMMARY_CHARS = 165;
/* ---------------------------------------------------------------- */

export async function onRequest() {
  try {
    const res = await fetch(FEED, {
      headers: { "user-agent": "hackers.bio (+https://hackers.bio)" },
      // Cloudflare keeps the feed cached for 30 min, so Substack is hit
      // roughly twice an hour no matter how many people visit the page.
      cf: { cacheTtl: 1800, cacheEverything: true },
    });
    if (!res.ok) throw new Error("feed responded " + res.status);

    const xml = await res.text();
    const blocks = xml.match(/<item\b[\s\S]*?<\/item>/g) || [];

    const items = blocks.slice(0, HOW_MANY).map((block) => ({
      title: text(pick(block, "title")),
      link: text(pick(block, "link")),
      date: text(pick(block, "pubDate")),
      summary: shorten(stripTags(text(pick(block, "description"))), SUMMARY_CHARS),
    })).filter((p) => p.title && p.link);

    return json({ items });
  } catch (err) {
    // The page hides the section rather than showing a broken one.
    return json({ items: [], error: String(err && err.message || err) });
  }
}

function json(body) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=900",
    },
  });
}

function pick(block, tag) {
  const m = block.match(new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">"));
  return m ? m[1] : "";
}

function text(raw) {
  return decode(raw.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")).trim();
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function shorten(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.\s]+$/, "") + "…";
}

const NAMED = {
  lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", middot: "·", bull: "•",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  laquo: "«", raquo: "»", deg: "°", times: "×", trade: "™",
  eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ntilde: "ñ",
  copy: "©", reg: "®", euro: "€", pound: "£",
};

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    // named entities, &amp; last so "&amp;mdash;" can't double-decode
    .replace(/&([a-z]+);/gi, (whole, name) => {
      const key = name.toLowerCase();
      return key === "amp" ? whole : (NAMED[key] !== undefined ? NAMED[key] : whole);
    })
    .replace(/&amp;/g, "&");
}
