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

// Dit bestand staat in `publiek/` en serveert zijn eigen map. Die map is de
// enige die naar Deno Deploy gaat: `deno deploy` uploadt alles onder de map
// die je opgeeft, en een map hoger liggen `worker/.env.local` met het
// Genkgo-token, `worker/index.js` met het adminwachtwoord en `backups/` met
// ledennamen en trainerscodes. Door `publiek/` uit te rollen in plaats van de
// projectmap kan dat niet per ongeluk mee.
//
// Door server.js hier neer te zetten werkt het uitrollen bovendien of de app
// nu op static staat (Deno levert de bestanden zelf uit) of op dynamic (dit
// bestand doet het). Er staat niets geheims in.
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

// Op Deno Deploy kiest het platform zelf de poort en luistert het mee; geef je
// er dan een vast nummer mee, dan bindt de app op iets waar het platform niet
// naar kijkt en blijft de uitrol eeuwig op "warming" staan. Zonder poort laten
// we Deno Deploy zijn gang gaan.
//
// Lokaal wil je wel kunnen kiezen, want 8000 is vaak bezet: zet dan PORT.
const poort = Number(Deno.env.get("PORT")) || 0;

Deno.serve(poort ? { port: poort } : {}, (req) => {
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
