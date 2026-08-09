/* ------------------------------------------------------------------
   hackers.bio — latest Substack posts
   Runs on Cloudflare (Workers), not in the browser, so there's no CORS
   problem and no third-party service in the middle.
   Answers at /api/substack ; everything else is served as a normal file.

   Feed for hackers.bio (Sergi). Change FEED only if the publication
   ever moves to a custom domain.
------------------------------------------------------------------- */
const FEED = "https://hackersbio.substack.com/feed";
const HOW_MANY = 3;
const SUMMARY_CHARS = 165;
/* ---------------------------------------------------------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // anything that is not the feed endpoint is a normal page or file
    if (url.pathname !== "/api/substack") return env.ASSETS.fetch(request);
    return feed();
  },
};

// Where the last good answer is kept, so a bad day at Substack
// doesn't empty the section on the page.
const BACKUP = new Request("https://hackers.bio/__substack-backup");

async function feed() {
  const store = caches.default;

  try {
    // "?cb=" cambia cada 30 min: obliga a Cloudflare a pedirlo de nuevo
    // en vez de devolver un 429 que se quedo guardado hace horas.
    const fresh = FEED + "?cb=" + Math.floor(Date.now() / 1800000);

    const res = await fetch(fresh, {
      headers: {
        // Substack answers 429 to requests that don't look like a browser
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
        "accept-language": "en;q=0.9",
      },
      // Guarda 30 min SOLO las respuestas buenas. Los errores no se
      // guardan, si no un 429 puntual se quedaba pegado media hora.
      cf: {
        cacheEverything: true,
        cacheTtlByStatus: { "200-299": 1800, "300-399": 0, "400-599": 0 },
      },
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

    const out = json({ items });
    if (items.length) await store.put(BACKUP, out.clone());
    return out;
  } catch (err) {
    let planB = "no intentado";
    // Plan B: Substack a veces bloquea a Cloudflare. Este servicio
    // lee el feed por su cuenta y nos lo pasa ya masticado.
    try {
      const alt = await fetch(
        "https://api.rss2json.com/v1/api.json?count=" + HOW_MANY +
        "&rss_url=" + encodeURIComponent(FEED),
        { cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 1800, "400-599": 0 } } }
      );
      const body = await alt.json();
      if (body.status === "ok" && body.items && body.items.length) {
        const items = body.items.slice(0, HOW_MANY).map((p) => ({
          title: p.title,
          link: p.link,
          date: p.pubDate,
          summary: shorten(stripTags(p.description || p.content || ""), SUMMARY_CHARS),
        }));
        const out = json({ items });
        await store.put(BACKUP, out.clone());
        return out;
      }
      planB = "respondio " + alt.status + " / status=" + body.status;
    } catch (e) {
      planB = String((e && e.message) || e);
    }

    // Ultima copia buena guardada, para no dejar la seccion vacia.
    const kept = await store.match(BACKUP);
    if (kept) return kept;
    // Nothing kept yet: the page hides the section rather than break.
    return json({
      items: [],
      version: "v4",
      directo: String((err && err.message) || err),
      planB: planB,
    });
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
