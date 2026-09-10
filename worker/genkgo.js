/**
 * Leest de trainingsindeling uit Genkgo.
 *
 * De trainingsgroepen staan in de organisatieboom onder
 * Planning > <jaar> > Training > <trainingsronde> > <dag>, en dragen alles
 * wat de app nodig heeft in hun profiel: trainer, tijd, speelsterkte, baan.
 * De indeling hoeft dus niet meer uit een Excel te komen.
 *
 * Van de spelers nemen we bewust alleen id en naam over. De API geeft ook
 * adres, IBAN, telefoonnummer en studentnummer terug; die horen niet in een
 * app waar elf trainers met een codewoord in kunnen.
 *
 * De naam is de roepnaam, niet de doopnaam: Genkgo levert "Tjalle Reinder
 * Hartmans" en "Anna Jaya Elisabeth Apte", en daar wil je een trainer geen
 * lijst mee laten afvinken.
 */

const BASIS = 'https://tam.genkgo.app/_/integration/api/v1';

// Genkgo gebruikt `middlename` niet consequent als tussenvoegsel: er staan net
// zo vaak doopnamen in ("Reinder", "Janna maria"). We nemen het veld daarom
// alleen over als het echt een tussenvoegsel is.
const TUSSENVOEGSELS = new Set([
  'van', 'de', 'der', 'den', 'het', 'te', 'ten', 'ter', "'t", 'op de', 'op den',
  'van de', 'van der', 'van den', 'van het', 'in de', 'in het', 'aan de',
  'bij de', "d'", 'du', 'le', 'la', 'el', 'a', 'à', 'op ten', "'s",
]);

/**
 * "Tjalle Reinder Hartmans" -> "Tjalle Hartmans"
 * "Quinn Van Hoolwerff"     -> "Quinn van Hoolwerff"
 * "eva de grave"            -> "Eva de Grave"
 */
export function roepnaam(profiel, terugval) {
  const given = String(profiel?.givenname || '').trim();
  const eerste = given.split(/\s+/)[0] || '';
  const achter = String(profiel?.surname || '').trim();
  let tussen = String(profiel?.middlename || '').trim().toLowerCase();
  if (!TUSSENVOEGSELS.has(tussen)) tussen = '';
  if (tussen && achter.toLowerCase().startsWith(tussen + ' ')) tussen = '';

  const naam = [eerste, tussen, achter].filter(Boolean).join(' ').trim();
  if (!naam) return String(terugval || '').trim();

  // Sommige namen staan in Genkgo helemaal in kleine letters ("eva de grave").
  // Alleen dan zetten we hoofdletters: zodra er ergens al een hoofdletter in
  // staat, is de naam met opzet zo geschreven en blijven we eraf. Anders
  // maakten we van "Lycklama a Nijeholt" een "Lycklama A Nijeholt".
  if (naam !== naam.toLowerCase()) return naam;
  return naam.split(' ').map((woord) => (
    TUSSENVOEGSELS.has(woord) ? woord : woord.charAt(0).toUpperCase() + woord.slice(1)
  )).join(' ');
}

async function haal(env, pad) {
  const res = await fetch(BASIS + pad, {
    headers: { 'X-Api-Token': env.GENKGO_API_TOKEN, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Genkgo ${pad} gaf ${res.status}`);
  return (await res.json()).resource;
}

export function slug(naam) {
  return naam.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** "1. Maandag" -> "Maandag" */
function dagNaam(map) {
  return String(map || '').replace(/^\d+\.\s*/, '').trim();
}

/** "13:30 - 14:30" -> "13:30-14:30" */
function tijdNaam(tijd) {
  return String(tijd || '').replace(/\s*-\s*/, '-').trim();
}

/**
 * "a. Maandag - Speelsterkte 9"        -> "Speelsterkte 9"
 * "c. Woensdag - Speelsterkte beginners" -> "Beginners"
 * "b. Vrijdag - Speelsterkte selectie / 4" -> "Selectie / 4"
 *
 * We leiden dit af uit de groepsnaam en niet uit x_speelsterkte: dat veld is
 * met de hand gevuld en staat er soms als "8" en soms als "Speelsterkte 8 ".
 */
function niveauNaam(groepsnaam) {
  let rest = String(groepsnaam).split(' - ').slice(1).join(' - ').trim();
  rest = rest.replace(/^speelsterkte\s+/i, '').trim();
  if (/^\d/.test(rest)) return `Speelsterkte ${rest}`;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/**
 * Haalt één trainingsronde op.
 * `map` is de id van de trainingsronde (TR1 2026-2027 = 18095).
 */
export async function haalIndeling(env, map) {
  const boom = await haal(env, `/organization/entry?resource%5Bparent%5D=${map}&recursive=1`);
  const groepen = boom.filter((e) => e.type === 'trainingGroup');

  // Cloudflare staat 50 subverzoeken per aanroep toe. De recursieve lijst
  // levert het profiel van elke groep al mee, dus we hoeven geen detail per
  // groep op te vragen: 1 + 37 verzoeken in plaats van 1 + 74.
  const uit = [];
  for (const g of groepen) {
    const leden = await haal(env, `/organization/entry/${g.id}/collection`);
    const p = g.profile || {};
    const naam = [dagNaam(g.parentFolderName), tijdNaam(p.x_tijd), niveauNaam(g.name)]
      .filter(Boolean).join(' ');

    uit.push({
      genkgoId: g.id,
      naam,
      id: slug(naam),
      trainer: String(p.x_Trainer || '').trim(),
      dag: dagNaam(g.parentFolderName),
      tijd: tijdNaam(p.x_tijd),
      baan: String(p.x_baan || '').trim(),
      capaciteit: p.capacity ?? null,
      spelers: leden.map((m) => ({
        id: m.entry.id,
        naam: roepnaam(m.entry.profile, m.entry.name),
        volledig: String(m.entry.name || '').trim(),
      })),
    });
  }
  return uit;
}
