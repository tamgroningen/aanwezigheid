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
 * Zoekt de trainingsronde die op dit moment telt.
 *
 * Onder de map Training staan mappen die altijd hetzelfde heten:
 * "Trainingsronde 1", "Trainingsronde 2", "Trainingsronde 3". De volgende
 * ronde wordt aangemaakt voordat hij gevuld is -- op 16-09-2026 bestond
 * Trainingsronde 2 al en stond er nog geen enkele groep in, terwijl ronde 1
 * net begonnen was.
 *
 * Daarom pakken we niet de hoogste ronde, maar de hoogste die ook echt iets
 * bevat. Zodra Niels de volgende ronde vult schuift de app vanzelf mee, en
 * tot die tijd blijft hij op de lopende ronde staan. Zonder die extra eis
 * zou de app leeglopen op het moment dat iemand de map alvast aanmaakt.
 */
export async function vindTrainingsronde(env, planningMap, huidige = {}) {
  const jaren = (await haal(env, `/organization/entry?resource%5Bparent%5D=${planningMap}`))
    .filter((m) => /^\d{4}-\d{4}$/.test(String(m.name).trim()))
    .sort((a, b) => String(b.name).localeCompare(String(a.name)));
  if (!jaren.length) throw new Error(`geen seizoensmappen onder Planning (${planningMap})`);

  // Eerst kijken waar de app al stond, daarna het nieuwste seizoen en zo
  // terug. Drie is genoeg: staat er in die drie niets, dan is er iets anders
  // aan de hand dan een seizoenswissel en moet er iemand naar kijken.
  const kandidaten = [
    ...jaren.filter((j) => j.id === Number(huidige.seizoen)),
    ...jaren.filter((j) => j.id !== Number(huidige.seizoen)),
  ].slice(0, 3);

  const bekeken = [];
  for (const jaar of kandidaten) {
    const inhoud = await haal(env, `/organization/entry?resource%5Bparent%5D=${jaar.id}`);
    const training = inhoud.find((e) => /^training$/i.test(String(e.name).trim()));
    if (!training) { bekeken.push(`${jaar.name}: geen map Training`); continue; }

    // Eén recursieve aanroep levert de rondes, de dagmappen en alle groepen.
    // Groepen hangen onder een dagmap, dus tellen gaat via die tussenstap.
    const boom = await haal(env, `/organization/entry?resource%5Bparent%5D=${training.id}&recursive=1`);
    const ouderVan = new Map(boom.map((e) => [e.id, e.parentFolderId]));
    const telling = new Map();
    for (const e of boom) {
      if (e.type !== 'trainingGroup') continue;
      const ronde = ouderVan.get(e.parentFolderId);
      telling.set(ronde, (telling.get(ronde) || 0) + 1);
    }

    const rondes = boom
      .filter((e) => e.parentFolderId === training.id)
      .map((e) => ({
        id: e.id,
        naam: e.name,
        nr: Number((/(\d+)/.exec(e.name) || [])[1] || 0),
        groepen: telling.get(e.id) || 0,
      }))
      .sort((a, b) => a.nr - b.nr);

    const gevuld = rondes.filter((r) => r.groepen > 0);
    if (!gevuld.length) {
      bekeken.push(`${jaar.name}: alle rondes leeg`);
      continue;
    }

    // Blijf staan waar de app al stond, zolang die ronde nog groepen heeft.
    //
    // Met opzet geen "pak de hoogste gevulde ronde". Een nieuwe ronde wordt
    // in Genkgo over meerdere dagen ingedeeld: eerst een paar groepen, de
    // volgende dag weer een paar. Zou de app meteen overspringen, dan raakten
    // de trainers van de nog lopende ronde halverwege hun lijsten kwijt.
    //
    // Overstappen is daarom een besluit dat iemand neemt. `rondes` en
    // `seizoenen` gaan mee terug zodat het beheerscherm kan laten zien dat er
    // een volgende ronde klaarstaat en hoe vol die inmiddels is.
    const gekozen = gevuld.find((r) => r.id === Number(huidige.ronde)) || gevuld[gevuld.length - 1];
    return {
      seizoen: { id: jaar.id, naam: jaar.name },
      ronde: gekozen,
      rondes,
      seizoenen: jaren.map((j) => ({ id: j.id, naam: j.name })),
      boom,
    };
  }

  throw new Error(`geen gevulde trainingsronde gevonden (${bekeken.join('; ')})`);
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
