/**
 * Zet de aanwezigheidsapp neer op aanwezigheid.tam.nl.
 *
 * Waarom niet GitHub Pages: de Genkgo-sessiecookie staat op `domain=tam.nl`
 * en gaat dus naar elk subdomein mee. Een lid dat de pagina opent, stuurt
 * daarmee zijn ingelogde tam.nl-sessie naar de host van dat subdomein. Op
 * Deno Deploy blijft die binnen infrastructuur van de vereniging; bij een
 * statische hoster van derden zou hij in hun logboeken belanden.
 *
 * De cookie wordt hier verder niet gebruikt -- trainers loggen in met hun
 * code -- maar hij komt wel langs, en dat is genoeg reden.
 *
 * De gegevens komen van de Cloudflare Worker (zie SYNC_URL in index.html);
 * dit is alleen de uitlevering van de pagina zelf.
 */

const MAP = import.meta.dirname;

const BESTANDEN = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/logo.webp": ["logo.webp", "image/webp"],
};

// Eenmalig inlezen: het zijn drie kleine bestanden en ze veranderen alleen
// bij een nieuwe deploy.
const inhoud = new Map();
for (const [pad, [naam, type]] of Object.entries(BESTANDEN)) {
  if (inhoud.has(naam)) continue;
  inhoud.set(naam, { data: await Deno.readFile(`${MAP}/${naam}`), type });
}

// Op Deno Deploy wordt de poort gegeven; lokaal is 8000 vaak al bezet.
const poort = Number(Deno.env.get("PORT")) || 8000;

Deno.serve({ port: poort }, (req) => {
  const pad = new URL(req.url).pathname;

  if (pad === "/health") {
    return Response.json({ ok: true, bestanden: [...inhoud.keys()] });
  }

  const treffer = BESTANDEN[pad];
  if (!treffer) return new Response("Niet gevonden", { status: 404 });

  const { data, type } = inhoud.get(treffer[0]);
  return new Response(data, {
    headers: {
      "Content-Type": type,
      // Kort cachen: trainers moeten een nieuwe versie meteen zien.
      "Cache-Control": "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    },
  });
});
