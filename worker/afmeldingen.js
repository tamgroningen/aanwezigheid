/**
 * Haalt de afmeldingen per trainingsdag op uit Genkgo.
 *
 * De integratie-API kan dit niet: die heeft geen planning-endpoint, en zijn
 * `POST /login` controleert alleen een wachtwoord (hij geeft geen sessie
 * terug). Daarom logt deze module in op de gewone site en leest hij het
 * Planning-tabblad van elke trainingsgroep, dat door de server als HTML
 * wordt uitgeleverd.
 *
 * Per datum staat daar: het aantal overnames / aanmeldingen / afmeldingen,
 * en de afzeggers bij naam. Van overnames zijn geen namen bekend; dat is een
 * eigenschap van Genkgo, niet van deze code.
 */

const SITE = 'https://tam.nl';

/* ---------- inloggen ---------- */

/**
 * Logt in en geeft de cookieregel terug die je daarna meestuurt.
 * Gooit met een duidelijke melding als het niet lukt -- die melding komt in
 * de status terecht, zodat je ziet wát er mis is en niet alleen dát er iets
 * mis is.
 */
export async function login(env, sporen = null) {
  if (!env.GENKGO_UID || !env.GENKGO_PASSWORD) {
    throw new Error('GENKGO_UID of GENKGO_PASSWORD ontbreekt');
  }

  // Let op: de beheeromgeving heeft een eigen inlog, los van die van de
  // site. Inloggen op tam.nl/inloggen levert een `gsitesess1` waarmee je
  // wel het ledengedeelte in komt, maar de beheerpagina's blijven je dan
  // doorsturen naar /admin/main/Login. Die tweede inlog werkt met een eigen
  // cookie (`gadminsess`) en met een CSRF-token uit de inlogpagina.
  const alsBrowser = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/128.0 Safari/537.36',
    'Accept-Language': 'nl-NL,nl;q=0.9',
  };

  const pagina = await fetch(`${SITE}/admin/main/Login`, {
    redirect: 'manual', headers: alsBrowser,
  });
  const html = await pagina.text();
  const koekjes = pakCookies(pagina);

  const token = (/name="_CSRF_TOKEN"[^>]*value="([^"]*)"/.exec(html)
    || /value="([^"]*)"[^>]*name="_CSRF_TOKEN"/.exec(html) || [])[1];
  if (!token) throw new Error('Geen CSRF-token op de inlogpagina van de beheeromgeving');

  const res = await fetch(`${SITE}/admin/main/doLogin`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...alsBrowser,
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: SITE,
      Referer: `${SITE}/admin/main/Login`,
      Cookie: koekjesRegel(koekjes),
    },
    body: new URLSearchParams({
      _CSRF_TOKEN: token,
      uid: env.GENKGO_UID,
      password: env.GENKGO_PASSWORD,
      remember: '1',
    }),
  });
  await res.body?.cancel();

  const naar = res.headers.get('location') || '';
  Object.assign(koekjes, pakCookies(res));

  if (sporen) {
    sporen.inlogpagina = { status: pagina.status, cookies: Object.keys(pakCookies(pagina)), token_gevonden: true };
    sporen.dologin = { status: res.status, naar, nieuwe_cookies: Object.keys(pakCookies(res)) };
  }

  if (res.status !== 302 || /Login/i.test(naar)) {
    throw new Error(`Inloggen op de beheeromgeving mislukt (${res.status}${naar ? ` -> ${naar}` : ''})`
      + ' -- gebruikersnaam of wachtwoord onjuist?');
  }
  if (!koekjes.gadminsess) throw new Error('Geen gadminsess-cookie na inloggen');

  return koekjesRegel(koekjes);
}

function pakCookies(res) {
  const uit = {};
  for (const rij of res.headers.getSetCookie?.() ?? []) {
    const [paar] = rij.split(';');
    const i = paar.indexOf('=');
    if (i > 0) uit[paar.slice(0, i).trim()] = paar.slice(i + 1).trim();
  }
  return uit;
}

const koekjesRegel = (k) => Object.entries(k).map(([n, v]) => `${n}=${v}`).join('; ');

/* ---------- planning lezen ---------- */

/**
 * De `eid` in de URL bepaalt alleen welke mappenboom in de zijbalk wordt
 * getekend, niet welke groep je ziet. Een vaste, geldige waarde volstaat --
 * dat scheelt het opbouwen van het hele pad per groep.
 */
const EID = '1.3';

/** "10-09-2026 14:00" -> "2026-09-10" */
function datum(tekst) {
  const m = /^(\d{2})-(\d{2})-(\d{4})/.exec(tekst.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const ontdoe = (h) => h.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** Leest het Planning-tabblad van één groep. */
export async function haalGroep(cookie, genkgoId) {
  const res = await fetch(
    `${SITE}/admin/organization/ModifyEntry?eid=${EID}&cid=${genkgoId}&tab=planning`,
    {
      headers: {
        Cookie: cookie,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
          + '(KHTML, like Gecko) Chrome/128.0 Safari/537.36',
      },
      redirect: 'manual',
    },
  );
  if (res.status !== 200) {
    await res.body?.cancel();
    const naar = res.headers.get('location') || '';
    throw new Error(`groep ${genkgoId} gaf ${res.status}${naar ? ` -> ${naar}` : ''}`);
  }
  const html = await res.text();

  const tabel = /<table[\s\S]*?<\/table>/i.exec(html);
  if (!tabel) throw new Error(`groep ${genkgoId}: geen planningtabel gevonden`);

  const dagen = {};
  for (const rij of tabel[0].split(/<tr[\s>]/i).slice(1)) {
    const cellen = [...rij.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cellen.length < 6) continue;

    const dag = datum(ontdoe(cellen[0]));
    if (!dag) continue;

    // kolom 5: "overnames / aanmeldingen / afmeldingen", of "-" als er niets is
    const telling = ontdoe(cellen[4]);
    const [ov, aan, af] = telling === '-' || !telling
      ? [0, 0, 0]
      : telling.split('/').map((s) => Number(s.trim()) || 0);

    // kolom 6: afzeggers, gescheiden door <br>
    const afzeggers = cellen[5].split(/<br\s*\/?>/i).map(ontdoe).filter(Boolean);

    dagen[dag] = { overnames: ov, aanmeldingen: aan, afmeldingen: af, afzeggers };
  }
  return dagen;
}

/**
 * Haalt alle opgegeven groepen op.
 *
 * Cloudflare staat 50 subverzoeken per aanroep toe en we gebruiken er
 * 2 + het aantal groepen. Bij 37 groepen zit daar ruimte in, maar niet
 * eindeloos: groeit de indeling voorbij ~45 groepen, dan moet dit over
 * meerdere aanroepen.
 */
export async function haalAlles(env, groepen, sporen = null) {
  const cookie = await login(env, sporen);
  const uit = {};
  const fouten = [];
  for (const g of groepen) {
    try {
      uit[String(g.genkgoId)] = await haalGroep(cookie, g.genkgoId);
    } catch (e) {
      fouten.push({ groep: g.name, genkgoId: g.genkgoId, fout: e.message });
    }
  }
  return { perGroep: uit, fouten };
}

/**
 * Is het nu 10 uur in Amsterdam?
 *
 * De cron van Cloudflare draait op UTC, en dat is 's zomers een uur naast
 * de Nederlandse tijd. Daarom draait hij om 08:00 en 09:00 UTC en bepaalt
 * deze functie welke van de twee de echte is.
 */
export function isTienUurInAmsterdam(nu = new Date()) {
  const uur = new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam', hour: 'numeric', hour12: false,
  }).format(nu);
  return Number(uur) === 10;
}
