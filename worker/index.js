import { haalIndeling, vindTrainingsronde, slug as slugify } from './genkgo.js';
import { haalAlles, isTienUurInAmsterdam } from './afmeldingen.js';

const ADMIN_PASSWORD = 'training2026';

// De map Planning in de Genkgo-organisatieboom. Daaronder staat per seizoen
// een map "2026-2027", daarin "Training", en daarin de trainingsrondes. De app
// zoekt zelf het seizoen en de ronde die tellen (zie vindTrainingsronde), dus
// bij een nieuwe ronde of een nieuw seizoen hoeft hier niets te veranderen.
//
// GENKGO_TRAININGSRONDE blijft bestaan als noodrem: zet daar een id in en de
// app gebruikt die ronde, wat er verder ook onder Planning staat.
const PLANNING_MAP = 3433;

const NAMES = [
  'federer', 'nadal', 'alcaraz', 'sinner', 'thiem',
  'swiatek', 'medvedev', 'dimitrov', 'zverev', 'raducanu', 'fritz',
  'sabalenka', 'draper', 'djokovic', 'murray',
];

function generateCode() {
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  const num = Math.floor(10 + Math.random() * 90);
  return `${name}${num}`;
}

function seedData() {
  return { trainers: [] };
}

/**
 * Een trainer vult in wat er is gebeurd, dus nooit vooruit.
 *
 * Tot 16-09-2026 kon dat wel, en er stonden 20 vinklijsten klaar op datums tot
 * in december. Die tellen niet mee zolang de dag nog niet is aangebroken en
 * gaan daarna stil meedoen, inclusief mensen die als afwezig genoteerd staan
 * voor een training die nog moest komen. Vandaar deze grendel in de worker:
 * het scherm verbergt de vakjes ook, maar dat is maar een scherm.
 *
 * Afmeldingen mogen wel vooruit lopen. Die komen uit Genkgo en worden hier
 * niet door een trainer ingevuld.
 */
function inDeToekomst(datum) {
  const vandaag = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return String(datum || '') > vandaag;
}

function validateCode(data, code) {
  if (code === ADMIN_PASSWORD) return { role: 'admin' };
  for (const t of data.trainers) {
    if (t.code === code) return { role: 'trainer', trainer_id: t.id, trainer_name: t.name };
  }
  return null;
}


/**
 * Haalt de afmeldingen op en schrijft ze weg.
 *
 * De afmeldingen komen in een eigen sleutel, niet in `data`. Dat is met
 * opzet: KV kent geen transacties, en als deze run tegelijk loopt met een
 * trainer die aanwezigheid aanvinkt, zou een gedeelde sleutel het werk van
 * die trainer kunnen overschrijven. Nu kunnen ze elkaar niet raken.
 *
 * Afzeggers die niet in de spelerslijst van hun groep staan, worden apart
 * bewaard in plaats van weggegooid. Dat gebeurt echt -- de planning in
 * Genkgo en het groepslidmaatschap lopen soms uit elkaar -- en als je zo'n
 * afmelding laat vallen, lijkt die persoon afwezig zonder afmelding. Dat is
 * precies wat een trainingsboete oplevert.
 */
async function draaiAfmeldingen(env, { schrijf, sporen: wilSporen }) {
  // Bij `debug` houden we bij wat er tijdens het inloggen gebeurt. Er staan
  // alleen statuscodes en cookienamen in, nooit een wachtwoord of de inhoud
  // van een cookie.
  const sporen = wilSporen ? {} : null;
  const vorig = JSON.parse(await env.AANWEZIGHEID.get('afmeldingen') || '{}');
  const nu = new Date().toISOString();

  const data = JSON.parse(await env.AANWEZIGHEID.get('data') || '{"trainers":[]}');
  const groepen = data.trainers.flatMap((t) =>
    (t.groups || []).filter((g) => g.genkgoId).map((g) => ({ ...g, trainer: t.name })));

  if (!groepen.length) {
    return { ok: false, melding: 'Geen groepen met een Genkgo-nummer; draai eerst /admin/sync' };
  }

  let opgehaald;
  try {
    opgehaald = await haalAlles(env, groepen, sporen);
  } catch (e) {
    const mislukt = (vorig.status?.mislukt_op_rij || 0) + 1;
    const status = { ...vorig.status, laatsteFout: { tijd: nu, melding: e.message }, mislukt_op_rij: mislukt };
    if (schrijf) {
      await env.AANWEZIGHEID.put('afmeldingen', JSON.stringify({ ...vorig, status }));
    }
    return { ok: false, melding: e.message, sporen, mislukt_op_rij: mislukt,
             let_op: mislukt >= 2 ? 'Twee keer op rij mislukt -- hier moet iemand naar kijken' : undefined };
  }

  // Afzeggers koppelen aan de spelers in de groep.
  //
  // De planningpagina toont de volledige naam uit Genkgo ("Anna Jaya
  // Elisabeth Apte"), terwijl de app de roepnaam gebruikt ("Anna Apte").
  // Vergelijken op de hele naam laat die twee dus niet bij elkaar komen.
  // We koppelen op voornaam plus achternaam; de doopnamen ertussen doen er
  // niet toe.
  const vlak = (n) => n.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
  const sleutel = (n) => { const w = vlak(n); return w.length ? `${w[0]} ${w[w.length - 1]}` : ''; };

  const onbekend = [];
  for (const g of groepen) {
    const dagen = opgehaald.perGroep[String(g.genkgoId)] || {};
    const spelers = new Map((g.players || []).map((p) => [sleutel(p), p]));
    for (const [datum, d] of Object.entries(dagen)) {
      // Naast de naam zoals Genkgo hem schrijft, bewaren we de naam zoals de
      // app die kent. Daarop kan de presentielijst straks matchen.
      d.gekoppeld = d.afzeggers.map((naam) => spelers.get(sleutel(naam)) || null);
      d.afzeggers.forEach((naam, i) => {
        if (!d.gekoppeld[i]) onbekend.push({ groep: g.name, trainer: g.trainer, datum, naam });
      });
    }
  }

  const nieuw = {
    bijgewerkt: nu,
    perGroep: opgehaald.perGroep,
    onbekend,
    fouten: opgehaald.fouten,
    status: { laatsteGeslaagd: nu, laatsteFout: vorig.status?.laatsteFout || null, mislukt_op_rij: 0 },
  };
  if (schrijf) await env.AANWEZIGHEID.put('afmeldingen', JSON.stringify(nieuw));

  // Meteen daarna bepalen wie er gemaild mag worden. Dit hoort bij dezelfde
  // dagelijkse run: de vergelijking met gisteren is precies wat de 24 uur
  // bewaakt, dus die moet één keer per dag gebeuren en niet vaker.
  if (schrijf) {
    try { await werkNietGekomenBij(env, data, opgehaald.perGroep); } catch (e) { /* niet fataal */ }
  }

  const dagen = Object.values(opgehaald.perGroep).flatMap((d) => Object.values(d));
  return {
    ok: true,
    geschreven: !!schrijf,
    sporen,
    groepen: Object.keys(opgehaald.perGroep).length,
    fouten: opgehaald.fouten,
    totaal_afmeldingen: dagen.reduce((n, d) => n + d.afzeggers.length, 0),
    totaal_overnames: dagen.reduce((n, d) => n + d.overnames, 0),
    onbekend,
  };
}

/**
 * Wie was er niet, zonder zich af te melden?
 *
 * Alleen trainingen die al zijn geweest, niet vervallen zijn en door de
 * trainer zijn ingevuld. Een training die nog niet is ingevuld zegt niets:
 * dan weten we alleen dat de trainer er nog niet aan toe is gekomen.
 */
function nietGekomen(data, perGroep) {
  const vandaag = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  const uit = [];
  for (const trainer of data.trainers) {
    for (const g of trainer.groups || []) {
      const planning = perGroep[String(g.genkgoId)] || {};
      const afgelast = new Set(g.cancelled || []);
      for (const datum of Object.keys(planning)) {
        if (datum > vandaag || afgelast.has(datum)) continue;
        const ingevuld = (g.attendance && datum in g.attendance)
          || (g.totalPresent && datum in g.totalPresent);
        if (!ingevuld) continue;

        const aanwezig = new Set((g.attendance || {})[datum] || []);
        const afgemeld = new Set([
          ...((planning[datum].gekoppeld || []).filter(Boolean)),
          ...(((g.excused || {})[datum]) || []),
        ]);
        for (const speler of g.players || []) {
          if (aanwezig.has(speler) || afgemeld.has(speler)) continue;
          uit.push({
            sleutel: `${g.id}|${datum}|${speler}`,
            speler, datum, groep: g.name, trainer: trainer.name,
            genkgoId: g.genkgoId,
            persoonId: Object.entries(g.playerIds || {}).find(([, n]) => n === speler)?.[0] || null,
          });
        }
      }
    }
  }
  return uit;
}

/**
 * Houdt bij wie er gemaild mag worden.
 *
 * De regel: pas mailen als iemand 24 uur onveranderd op afwezig staat. Dat
 * meten we niet met tijdstempels maar door de meting van vandaag te
 * vergelijken met die van gisteren. Staat iemand in allebei, dan is het beeld
 * een dag stabiel en heeft de trainer de tijd gehad zich te herstellen.
 *
 * Dat vangt de trainer die midden in het invullen zit als de ochtendrun
 * langskomt: die halve lijst ziet er morgen anders uit, en alleen wat er dan
 * nog staat telt. En het vangt de trainer die pas een week later invult, want
 * de 24 uur begint te lopen op het moment dat hij invult, niet op de dag van
 * de training zelf.
 *
 * Wie gemaild is blijft in `gemaild` staan, zodat niemand twee keer hetzelfde
 * bericht krijgt als de trainer er later nog eens in gaat.
 */
async function werkNietGekomenBij(env, data, perGroep) {
  const opslag = JSON.parse(await env.AANWEZIGHEID.get('nietgekomen') || '{}');
  const vorige = new Set(opslag.vorige || []);
  const gemaild = opslag.gemaild || {};

  const huidig = nietGekomen(data, perGroep);
  const klaar = huidig.filter((r) => vorige.has(r.sleutel) && !gemaild[r.sleutel]);

  const nieuw = {
    bijgewerkt: new Date().toISOString(),
    vorige: huidig.map((r) => r.sleutel),
    gemaild,
    klaar,
    // Alleen ter informatie: hoeveel er nog een dag moeten rijpen.
    wacht: huidig.filter((r) => !vorige.has(r.sleutel) && !gemaild[r.sleutel]).length,
  };
  await env.AANWEZIGHEID.put('nietgekomen', JSON.stringify(nieuw));
  return nieuw;
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

    async function getData() {
      const raw = await env.AANWEZIGHEID.get('data');
      if (!raw) {
        const data = seedData();
        await env.AANWEZIGHEID.put('data', JSON.stringify(data));
        return data;
      }
      return JSON.parse(raw);
    }

    async function saveData(data) {
      await env.AANWEZIGHEID.put('data', JSON.stringify(data));
    }

    // GET /data — public, strips trainer codes
    if (request.method === 'GET' && path === '/data') {
      const data = await getData();
      const pub = JSON.parse(JSON.stringify(data));
      for (const t of pub.trainers) {
        delete t.code;
        // playerIds zijn Genkgo-persoonsnummers; die hoeven niet het publiek in.
        for (const g of t.groups || []) delete g.playerIds;
      }
      return json(pub);
    }

    // POST /login
    if (request.method === 'POST' && path === '/login') {
      const { code } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth) return json({ ok: false, error: 'Onjuiste code' }, 401);
      if (auth.role === 'admin') {
        return json({ ok: true, ...auth, data });
      }
      // Return only this trainer's data
      const trainer = data.trainers.find(t => t.id === auth.trainer_id);
      return json({ ok: true, ...auth, trainer });
    }

    // POST /attendance — trainer marks attendance for a date
    if (request.method === 'POST' && path === '/attendance') {
      const { code, trainer_id, group_id, date, present_players } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth) return json({ error: 'Onjuiste code' }, 401);
      if (auth.role !== 'admin' && auth.trainer_id !== trainer_id) {
        return json({ error: 'Geen toegang' }, 403);
      }
      const trainer = data.trainers.find(t => t.id === trainer_id);
      if (inDeToekomst(date)) {
        return json({ error: 'Deze training is nog niet geweest; invullen kan tot en met vandaag' }, 400);
      }
      if (!trainer) return json({ error: 'Trainer niet gevonden' }, 404);
      const group = trainer.groups.find(g => g.id === group_id);
      if (!group) return json({ error: 'Groep niet gevonden' }, 404);
      if (!group.attendance) group.attendance = {};
      group.attendance[date] = present_players || [];
      await saveData(data);
      return json({ ok: true });
    }

    // POST /excused — trainer marks excused absences for a date
    if (request.method === 'POST' && path === '/excused') {
      const { code, trainer_id, group_id, date, excused_players } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth) return json({ error: 'Onjuiste code' }, 401);
      if (auth.role !== 'admin' && auth.trainer_id !== trainer_id) {
        return json({ error: 'Geen toegang' }, 403);
      }
      const trainer = data.trainers.find(t => t.id === trainer_id);
      if (!trainer) return json({ error: 'Trainer niet gevonden' }, 404);
      const group = trainer.groups.find(g => g.id === group_id);
      if (!group) return json({ error: 'Groep niet gevonden' }, 404);
      if (!group.excused) group.excused = {};
      group.excused[date] = excused_players || [];
      await saveData(data);
      return json({ ok: true });
    }

    // POST /attendance-full — admin sets both present and excused in one operation
    if (request.method === 'POST' && path === '/attendance-full') {
      const { code, trainer_id, group_id, date, present_players, excused_players } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth) return json({ error: 'Onjuiste code' }, 401);
      if (auth.role !== 'admin' && auth.trainer_id !== trainer_id) {
        return json({ error: 'Geen toegang' }, 403);
      }
      const trainer = data.trainers.find(t => t.id === trainer_id);
      if (inDeToekomst(date)) {
        return json({ error: 'Deze training is nog niet geweest; invullen kan tot en met vandaag' }, 400);
      }
      if (!trainer) return json({ error: 'Trainer niet gevonden' }, 404);
      const group = trainer.groups.find(g => g.id === group_id);
      if (!group) return json({ error: 'Groep niet gevonden' }, 404);
      if (!group.attendance) group.attendance = {};
      if (!group.excused) group.excused = {};
      group.attendance[date] = present_players || [];
      group.excused[date] = excused_players || [];
      await saveData(data);
      return json({ ok: true });
    }

    // POST /total-present — trainer or admin sets total present (incl. subs) for a date
    if (request.method === 'POST' && path === '/total-present') {
      const { code, trainer_id, group_id, date, total } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth) return json({ error: 'Onjuiste code' }, 401);
      if (auth.role !== 'admin' && auth.trainer_id !== trainer_id) {
        return json({ error: 'Geen toegang' }, 403);
      }
      const trainer = data.trainers.find(t => t.id === trainer_id);
      if (inDeToekomst(date)) {
        return json({ error: 'Deze training is nog niet geweest; invullen kan tot en met vandaag' }, 400);
      }
      if (!trainer) return json({ error: 'Trainer niet gevonden' }, 404);
      const group = trainer.groups.find(g => g.id === group_id);
      if (!group) return json({ error: 'Groep niet gevonden' }, 404);
      if (!group.totalPresent) group.totalPresent = {};
      if (total === null || total === '') {
        delete group.totalPresent[date];
      } else {
        group.totalPresent[date] = Number(total);
      }
      await saveData(data);
      return json({ ok: true });
    }

    // POST /cancel — trainer or admin toggles a date as cancelled
    if (request.method === 'POST' && path === '/cancel') {
      const { code, trainer_id, group_id, date, cancel } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth) return json({ error: 'Onjuiste code' }, 401);
      if (auth.role !== 'admin' && auth.trainer_id !== trainer_id) {
        return json({ error: 'Geen toegang' }, 403);
      }
      const trainer = data.trainers.find(t => t.id === trainer_id);
      if (!trainer) return json({ error: 'Trainer niet gevonden' }, 404);
      const group = trainer.groups.find(g => g.id === group_id);
      if (!group) return json({ error: 'Groep niet gevonden' }, 404);
      if (!group.cancelled) group.cancelled = [];
      if (cancel && !group.cancelled.includes(date)) {
        group.cancelled.push(date);
      } else if (!cancel) {
        group.cancelled = group.cancelled.filter(d => d !== date);
      }
      await saveData(data);
      return json({ ok: true });
    }

    // POST /admin/trainer — add or edit trainer
    if (request.method === 'POST' && path === '/admin/trainer') {
      const { code, action, trainer_id, name } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);

      if (action === 'add') {
        const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        if (data.trainers.find(t => t.id === id)) return json({ error: 'Trainer bestaat al' }, 400);
        data.trainers.push({ id, name, code: generateCode(), groups: [] });
      } else if (action === 'delete') {
        data.trainers = data.trainers.filter(t => t.id !== trainer_id);
      }
      await saveData(data);
      return json({ ok: true, data });
    }

    // POST /admin/group — add or edit group for a trainer
    if (request.method === 'POST' && path === '/admin/group') {
      const { code, action, trainer_id, group_id, name } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);

      const trainer = data.trainers.find(t => t.id === trainer_id);
      if (!trainer) return json({ error: 'Trainer niet gevonden' }, 404);

      if (action === 'add') {
        const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        trainer.groups.push({ id, name, players: [], dates: [], cancelled: [], attendance: {} });
      } else if (action === 'delete') {
        trainer.groups = trainer.groups.filter(g => g.id !== group_id);
      }
      await saveData(data);
      return json({ ok: true, data });
    }

    // POST /admin/players — update group players
    if (request.method === 'POST' && path === '/admin/players') {
      const { code, trainer_id, group_id, players } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);

      const trainer = data.trainers.find(t => t.id === trainer_id);
      if (!trainer) return json({ error: 'Trainer niet gevonden' }, 404);
      const group = trainer.groups.find(g => g.id === group_id);
      if (!group) return json({ error: 'Groep niet gevonden' }, 404);
      group.players = players;
      await saveData(data);
      return json({ ok: true, data });
    }

    // POST /admin/dates — update group dates and cancelled dates
    if (request.method === 'POST' && path === '/admin/dates') {
      const { code, trainer_id, group_id, dates, cancelled } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);

      const trainer = data.trainers.find(t => t.id === trainer_id);
      if (!trainer) return json({ error: 'Trainer niet gevonden' }, 404);
      const group = trainer.groups.find(g => g.id === group_id);
      if (!group) return json({ error: 'Groep niet gevonden' }, 404);
      if (dates) group.dates = dates;
      if (cancelled) group.cancelled = cancelled;
      await saveData(data);
      return json({ ok: true, data });
    }


    // POST /admin/sync — haalt de indeling uit Genkgo
    //
    // Zonder `apply` verandert er niets: je krijgt alleen het plan te zien.
    // Met `apply: true` wordt het uitgevoerd, na een back-up.
    //
    // Aanwezigheid, afgelaste data, totalen en trainerscodes blijven staan.
    // Groepen die in Genkgo niet meer bestaan worden gemeld, niet verwijderd:
    // daar hangt aanwezigheidsgeschiedenis aan.
    if (request.method === 'POST' && path === '/admin/sync') {
      const body = await request.json();
      const data = await getData();
      const auth = validateCode(data, body.code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);
      if (!env.GENKGO_API_TOKEN) return json({ error: 'GENKGO_API_TOKEN ontbreekt' }, 500);

      // Waar stond de app? Die keuze telt zwaarder dan "de nieuwste ronde",
      // zodat een half ingedeelde volgende ronde de lopende niet wegdrukt.
      // Met `ronde` in het verzoek stap je er bewust naartoe over.
      const gevraagd = body.ronde
        ? { seizoen: body.seizoen, ronde: body.ronde }
        : (data.genkgo || {});

      let indeling, keuze;
      try {
        keuze = env.GENKGO_TRAININGSRONDE
          ? { seizoen: null, ronde: { id: Number(env.GENKGO_TRAININGSRONDE), naam: 'handmatig ingesteld' },
              rondes: [], seizoenen: [] }
          : await vindTrainingsronde(env, env.GENKGO_PLANNING_MAP || PLANNING_MAP, gevraagd);
        indeling = await haalIndeling(env, keuze.ronde.id);
      } catch (e) {
        return json({ error: `Genkgo niet gelezen: ${e.message}` }, 502);
      }
      if (!indeling.length) return json({ error: 'Genkgo gaf geen groepen terug' }, 502);

      // De boom hoeft niet mee terug, die is alleen intern nodig geweest.
      const genkgo = { seizoen: keuze.seizoen, ronde: { id: keuze.ronde.id, naam: keuze.ronde.naam },
                       rondes: keuze.rondes, seizoenen: keuze.seizoenen };

      // alle app-groepen op een rij, met hun trainer erbij
      const appGroepen = [];
      for (const t of data.trainers) {
        for (const g of t.groups) appGroepen.push({ trainer: t, groep: g });
      }

      // Namen vergelijken we op voornaam+achternaam, kleine letters, zonder
      // accenten. Zo koppelt "Valerie Founier" nog niet aan "Valerie Fournier"
      // -- dat blijft een verwijdering plus een toevoeging, en dat is eerlijk:
      // wij weten niet of het een typefout of een andere persoon is.
      const vlak = (n) => n.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z ]/g, '').trim();

      const gebruikt = new Set();
      const paren = [];   // { bron, doel } -- de daadwerkelijke koppeling
      const overgeslagen = [];
      const plan = [];

      for (const bron of indeling) {
        // 1. eerder gekoppeld?
        let doel = appGroepen.find((a) => a.groep.genkgoId === bron.genkgoId);
        // 2. anders: de app-groep met de meeste dezelfde spelers
        if (!doel) {
          const namen = new Set(bron.spelers.map((s) => vlak(s.naam)));
          let beste = null, score = 0;
          for (const a of appGroepen) {
            if (gebruikt.has(a.groep) || a.groep.genkgoId) continue;
            const n = (a.groep.players || []).filter((p) => namen.has(vlak(p))).length;
            if (n > score) { score = n; beste = a; }
          }
          const drempel = Math.max(3, Math.ceil(namen.size * 0.4));
          if (beste && score >= drempel) doel = beste;
        }

        if (!doel) {
          paren.push({ bron, doel: null });
          plan.push({ soort: 'nieuwe-groep', groep: bron.naam, trainer: bron.trainer,
                      spelers: bron.spelers.length });
          continue;
        }
        gebruikt.add(doel.groep);
        paren.push({ bron, doel });

        const wijzigingen = [];
        if (doel.groep.name !== bron.naam) {
          wijzigingen.push({ veld: 'naam', van: doel.groep.name, naar: bron.naam });
        }
        if (vlak(doel.trainer.name) !== vlak(bron.trainer)) {
          const bekend = data.trainers.some((x) => vlak(x.name) === vlak(bron.trainer));
          wijzigingen.push({ veld: 'trainer', van: doel.trainer.name, naar: bron.trainer,
            let_op: bekend
              ? 'wordt niet automatisch doorgevoerd; stuur trainers:true mee'
              : `"${bron.trainer}" bestaat niet in de app -- typefout in Genkgo, of een echt nieuwe trainer` });
        }
        const nu = doel.groep.players || [];
        const ids = doel.groep.playerIds || {};

        // Wie we al bij naam kennen via zijn Genkgo-id, is geen nieuwe speler
        // maar een hernoeming. Die moet ook in de aanwezigheid doorwerken,
        // anders staat iemand ineens als afwezig genoteerd.
        const hernoemd = [];
        for (const s of bron.spelers) {
          const oudeNaam = ids[String(s.id)];
          // Exact vergelijken, niet met vlak(): een verschil in alleen een accent
          // of een hoofdletter ("À" tegen "à") is voor de vinkjes wel degelijk
          // een andere naam, en zou anders onopgemerkt blijven staan.
          if (oudeNaam && oudeNaam !== s.naam && nu.some((p) => vlak(p) === vlak(oudeNaam))) {
            hernoemd.push({ van: oudeNaam, naar: s.naam });
          }
        }
        const isHernoemd = (n) => hernoemd.some((h) => vlak(h.van) === vlak(n) || vlak(h.naar) === vlak(n));

        const erbij = bron.spelers.map((s) => s.naam)
          .filter((n) => !nu.some((p) => vlak(p) === vlak(n)) && !isHernoemd(n));
        const eraf = nu.filter((p) => !bron.spelers.some((s) => vlak(s.naam) === vlak(p)) && !isHernoemd(p));
        if (hernoemd.length) wijzigingen.push({ veld: 'hernoemd', namen: hernoemd });
        if (erbij.length) wijzigingen.push({ veld: 'spelers-erbij', namen: erbij });
        if (eraf.length) wijzigingen.push({ veld: 'spelers-eraf', namen: eraf });

        if (wijzigingen.length) {
          plan.push({ soort: 'wijziging', groep: doel.groep.name,
                      genkgoId: bron.genkgoId, wijzigingen });
        }
        if (!doel.groep.genkgoId) {
          plan.push({ soort: 'koppeling', groep: doel.groep.name, genkgoId: bron.genkgoId });
        }
      }

      for (const a of appGroepen) {
        if (!gebruikt.has(a.groep) && !indeling.some((b) => b.genkgoId === a.groep.genkgoId)) {
          plan.push({ soort: 'niet-in-genkgo', groep: a.groep.name, trainer: a.trainer.name,
                      let_op: 'blijft staan; verwijder hem zelf als de groep echt weg is' });
        }
      }

      if (!body.apply) {
        return json({ ok: true, toegepast: false, genkgo, groepen_in_genkgo: indeling.length, plan });
      }

      // ---- uitvoeren ----
      await env.AANWEZIGHEID.put(`backup:voor-sync-${new Date().toISOString().slice(0, 19)}`,
        JSON.stringify(data));

      // Een trainer die we nog niet kennen maken we niet zomaar aan. Aan een
      // trainer hangt zijn inlogcode, en x_Trainer in Genkgo is vrije tekst:
      // een typefout ("Philipa" tegen "Philippa") zou anders stil een tweede
      // account met een nieuwe code opleveren terwijl de oude code naar een
      // lege lijst wijst. Alleen met trainers:true mag het.
      const zoekTrainer = (naam) => {
        const t = data.trainers.find((x) => vlak(x.name) === vlak(naam));
        if (t) return t;
        if (!body.trainers) return null;
        const nieuw = { id: slugify(naam), name: naam, code: generateCode(), groups: [] };
        data.trainers.push(nieuw);
        return nieuw;
      };

      // We gebruiken de koppelingen uit de planfase rechtstreeks. Eerder zocht
      // ik de groep hier opnieuw op naam op, en groepsnamen zijn niet uniek:
      // twee trainers hebben allebei een "Woensdag 13:00-14:00 Speelsterkte 8".
      for (const { bron, doel } of paren) {
        if (!doel) {
          const t = zoekTrainer(bron.trainer);
          if (!t) {
            overgeslagen.push({ groep: bron.naam, trainer: bron.trainer,
              waarom: 'onbekende trainer; controleer de spelling in Genkgo of stuur trainers:true mee' });
            continue;
          }
          t.groups.push({ id: bron.id, name: bron.naam, genkgoId: bron.genkgoId,
                          capaciteit: bron.capaciteit, baan: bron.baan,
                          players: bron.spelers.map((s) => s.naam),
                          playerIds: Object.fromEntries(bron.spelers.map((s) => [String(s.id), s.naam])),
                          dates: [], cancelled: [], attendance: {}, totalPresent: {} });
          continue;
        }

        const g = doel.groep;
        const ids = g.playerIds || {};

        // Hernoemingen ook in de al ingevulde aanwezigheid doorvoeren.
        for (const s of bron.spelers) {
          const oudeNaam = ids[String(s.id)];
          if (!oudeNaam || oudeNaam === s.naam) continue;
          for (const datum of Object.keys(g.attendance || {})) {
            g.attendance[datum] = g.attendance[datum]
              .map((n) => (vlak(n) === vlak(oudeNaam) ? s.naam : n));
          }
        }

        g.genkgoId = bron.genkgoId;
        g.name = bron.naam;
        // Capaciteit en baan komen uit het groepsprofiel in Genkgo. De app
        // rekent er niets mee -- het gemiddelde meet opkomst en deelt door
        // het aantal spelers -- maar dit is wel de plek waar je de echte
        // baancapaciteit vandaan haalt als je ooit bezetting wilt meten.
        g.capaciteit = bron.capaciteit;
        g.baan = bron.baan;
        g.players = bron.spelers.map((s) => s.naam);
        g.playerIds = Object.fromEntries(bron.spelers.map((s) => [String(s.id), s.naam]));
        g.id = bron.id;
        if (!g.cancelled) g.cancelled = [];
        if (!g.attendance) g.attendance = {};
        if (!g.totalPresent) g.totalPresent = {};

        // Een trainer verplaatsen doen we alleen als daar expliciet om wordt
        // gevraagd. Aan een trainer hangt zijn inlogcode, en een naam die in
        // Genkgo net anders is gespeld ("Philipa" tegen "Philippa") zou hier
        // een tweede trainer met een nieuwe code opleveren terwijl de oude
        // code naar een lege trainer blijft wijzen.
        if (body.trainers) {
          const juisteTrainer = zoekTrainer(bron.trainer);
          if (juisteTrainer && juisteTrainer !== doel.trainer) {
            doel.trainer.groups = doel.trainer.groups.filter((x) => x !== g);
            juisteTrainer.groups.push(g);
          }
        }
      }

      // Onthouden waar we staan, zodat een volgende sync hier blijft en niet
      // vanzelf naar een half ingedeelde volgende ronde springt.
      data.genkgo = { seizoen: genkgo.seizoen, ronde: genkgo.ronde };
      await saveData(data);

      // Meteen de planning ophalen. Een zojuist toegevoegde groep heeft nog
      // geen lesdagen, en die komen uit de planning; zonder dit zou hij tot
      // de volgende ochtend op nul lessen staan.
      ctx.waitUntil(draaiAfmeldingen(env, { schrijf: true }).catch(() => {}));

      return json({ ok: true, toegepast: true, genkgo, groepen_in_genkgo: indeling.length,
                    plan, overgeslagen, data });
    }


    // POST /admin/backups — welke momentopnames er in de opslag staan
    if (request.method === 'POST' && path === '/admin/backups') {
      const { code } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);
      const lijst = await env.AANWEZIGHEID.list({ prefix: 'backup:' });
      return json({ ok: true, backups: lijst.keys.map((k) => k.name).sort().reverse() });
    }

    // POST /admin/restore — zet een momentopname terug
    //
    // De huidige stand wordt eerst zelf weer weggeschreven, zodat ook een
    // verkeerd herstel nog terug te draaien is.
    if (request.method === 'POST' && path === '/admin/restore') {
      const { code, key } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);
      if (!key || !key.startsWith('backup:')) return json({ error: 'Geen geldige sleutel' }, 400);

      const raw = await env.AANWEZIGHEID.get(key);
      if (!raw) return json({ error: `${key} bestaat niet` }, 404);
      let terug;
      try { terug = JSON.parse(raw); } catch { return json({ error: 'Onleesbare back-up' }, 500); }
      if (!Array.isArray(terug.trainers)) return json({ error: 'Back-up bevat geen trainers' }, 500);

      await env.AANWEZIGHEID.put(`backup:voor-herstel-${new Date().toISOString().slice(0, 19)}`,
        JSON.stringify(data));
      await saveData(terug);
      const groepen = terug.trainers.flatMap((t) => t.groups || []);
      return json({ ok: true, hersteld: key, trainers: terug.trainers.length,
                    groepen: groepen.length,
                    spelers: groepen.reduce((n, g) => n + (g.players || []).length, 0) });
    }


    // POST /admin/herstel-namen — repareert vinkjes die door een naamswijziging
    // niet meer bij een speler horen.
    //
    // Nodig voor de eerste sync: toen had nog geen enkele speler zijn
    // Genkgo-nummer, dus een gewijzigde spelling zag eruit als "de een eraf,
    // de ander erbij" en bleef de oude naam als los vinkje achter. Daarna
    // gebeurt dit niet meer: de sync werkt vanaf nu op nummer.
    //
    // Zonder `apply` verandert er niets.
    if (request.method === 'POST' && path === '/admin/herstel-namen') {
      const body = await request.json();
      const data = await getData();
      const auth = validateCode(data, body.code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);

      const plat = (n) => n.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z]/g, '');
      const delen = (n) => n.trim().split(/\s+/).filter(Boolean);

      const gedaan = []; const onduidelijk = [];
      for (const t of data.trainers) {
        for (const g of t.groups) {
          const spelers = g.players || [];
          const kwijt = new Set();
          for (const datum of Object.keys(g.attendance || {})) {
            for (const n of g.attendance[datum]) if (!spelers.includes(n)) kwijt.add(n);
          }
          for (const n of kwijt) {
            // 1. zelfde naam, andere hoofdletters of accenten
            let kand = spelers.filter((p) => plat(p) === plat(n));
            // 2. anders: zelfde voornaam of zelfde achternaam, en dan uniek
            if (!kand.length) {
              const w = delen(n);
              if (w.length) {
                const voor = plat(w[0]); const achter = plat(w[w.length - 1]);
                kand = spelers.filter((p) => {
                  const q = delen(p);
                  return q.length && (plat(q[0]) === voor || plat(q[q.length - 1]) === achter);
                });
              }
            }
            if (kand.length !== 1) {
              onduidelijk.push({ groep: g.name, naam: n, kandidaten: kand });
              continue;
            }
            gedaan.push({ groep: g.name, van: n, naar: kand[0] });
            if (body.apply) {
              for (const datum of Object.keys(g.attendance)) {
                g.attendance[datum] = g.attendance[datum]
                  .map((x) => (x === n ? kand[0] : x));
              }
            }
          }
        }
      }

      if (body.apply && gedaan.length) {
        await env.AANWEZIGHEID.put(`backup:voor-herstel-namen-${new Date().toISOString().slice(0, 19)}`,
          JSON.stringify(await getData()));
        await saveData(data);
      }
      return json({ ok: true, toegepast: !!body.apply, hersteld: gedaan, onduidelijk });
    }


    // POST /admin/afmeldingen — haalt de afmeldingen van vandaag op
    //
    // Zonder `apply` wordt er niets weggeschreven; je krijgt alleen te zien
    // wat er gevonden is. Zo kun je de run controleren zonder gevolgen.
    if (request.method === 'POST' && path === '/admin/afmeldingen') {
      const body = await request.json();
      const data = await getData();
      const auth = validateCode(data, body.code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);
      const uitkomst = await draaiAfmeldingen(env, { schrijf: !!body.apply, sporen: !!body.debug });
      return json(uitkomst, uitkomst.ok ? 200 : 502);
    }

    // POST /afmeldingen — voor trainers en beheer: wat is er opgehaald
    if (request.method === 'POST' && path === '/afmeldingen') {
      const { code } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth) return json({ error: 'Onjuiste code' }, 401);

      const opslag = JSON.parse(await env.AANWEZIGHEID.get('afmeldingen') || '{}');
      if (auth.role === 'admin') return json({ ok: true, ...opslag });

      // een trainer krijgt alleen zijn eigen groepen te zien
      const trainer = data.trainers.find((t) => t.id === auth.trainer_id);
      const eigen = new Set((trainer?.groups || []).map((g) => String(g.genkgoId)));
      const perGroep = {};
      for (const [id, dagen] of Object.entries(opslag.perGroep || {})) {
        if (eigen.has(id)) perGroep[id] = dagen;
      }
      return json({ ok: true, bijgewerkt: opslag.bijgewerkt, perGroep });
    }


    // POST /admin/wis-toekomst — haalt aanwezigheid weg op datums die nog
    // moeten komen. Per ongeluk vooruit aangevinkte trainingen tellen mee
    // zodra die dag aanbreekt; dan staat iemand aanwezig op een training die
    // nog niet is geweest.
    //
    // Zonder `apply` zie je alleen wat er weg zou gaan.
    if (request.method === 'POST' && path === '/admin/wis-toekomst') {
      const { code, vanaf, trainer_id, apply } = await request.json();
      const data = await getData();
      const auth = validateCode(data, code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(vanaf || '')) {
        return json({ error: 'Geef `vanaf` als jjjj-mm-dd' }, 400);
      }

      const weg = [];
      for (const t of data.trainers) {
        if (trainer_id && t.id !== trainer_id) continue;
        for (const g of t.groups) {
          for (const soort of ['attendance', 'excused', 'totalPresent']) {
            for (const datum of Object.keys(g[soort] || {})) {
              if (datum < vanaf) continue;
              const w = g[soort][datum];
              weg.push({ trainer: t.name, groep: g.name, datum, soort,
                         inhoud: Array.isArray(w) ? w.length : w });
              if (apply) delete g[soort][datum];
            }
          }
        }
      }

      if (apply && weg.length) {
        await env.AANWEZIGHEID.put(`backup:voor-wissen-${new Date().toISOString().slice(0, 19)}`,
          JSON.stringify(await getData()));
        await saveData(data);
      }
      return json({ ok: true, toegepast: !!apply, aantal: weg.length, weg });
    }

    // POST /admin/niet-gekomen — wie er gemaild mag worden
    //
    // Alleen wie 24 uur onveranderd op afwezig staat. De mailadressen worden
    // hier bij Genkgo opgehaald en nergens bewaard: de app slaat van spelers
    // bewust alleen naam en persoonsnummer op.
    if (request.method === 'POST' && path === '/admin/niet-gekomen') {
      const body = await request.json();
      const data = await getData();
      const auth = validateCode(data, body.code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);

      const opslag = JSON.parse(await env.AANWEZIGHEID.get('nietgekomen') || '{}');
      const klaar = opslag.klaar || [];

      // Hoe vaak is iemand deze ronde al niet komen opdagen? Dat hoort in de
      // mail, want er hangt een boete aan de derde keer.
      const afm = JSON.parse(await env.AANWEZIGHEID.get('afmeldingen') || '{}');
      const alles = nietGekomen(data, afm.perGroep || {});
      const telling = {};
      for (const r of alles) telling[r.speler] = (telling[r.speler] || 0) + 1;

      let regels = klaar.map((r) => ({ ...r, keer: telling[r.speler] || 1 }));

      let rest = 0;
      if (body.adressen) {
        // Eén verzoek per persoon, en Cloudflare staat er 50 toe per aanroep.
        // Wie meer regels heeft haalt ze in stukken op met `vanaf`; `rest`
        // zegt hoeveel er nog volgen.
        const ruimte = 45;
        const vanaf = Number(body.vanaf) || 0;
        regels = regels.slice(vanaf);

        // Knippen op de regel waar de 46e persoon zou beginnen. Simpelweg de
        // eerste 45 personen pakken gaat mis: dan komen er regels mee van
        // iemand die er niet bij zat, en die krijgen dan geen adres.
        const uniek = [];
        let tot = regels.length;
        for (let i = 0; i < regels.length; i++) {
          const id = regels[i].persoonId;
          if (!id || uniek.includes(id)) continue;
          if (uniek.length === ruimte) { tot = i; break; }
          uniek.push(id);
        }
        rest = regels.length - tot;
        regels = regels.slice(0, tot);
        const mails = {};
        for (const id of uniek) {
          try {
            const res = await fetch(
              `https://tam.genkgo.app/_/integration/api/v1/organization/entry/${id}`,
              { headers: { 'X-Api-Token': env.GENKGO_API_TOKEN, Accept: 'application/json' } });
            if (!res.ok) continue;
            const r = (await res.json()).resource;
            mails[id] = ((Array.isArray(r) ? r[0] : r)?.profile || {}).mail || null;
          } catch (e) { /* zonder adres kan deze regel niet verstuurd worden */ }
        }
        regels = regels.map((r) => ({ ...r, mail: mails[r.persoonId] || null }));
      }

      return json({ ok: true, bijgewerkt: opslag.bijgewerkt, wacht: opslag.wacht || 0,
                    aantal: regels.length, rest, regels });
    }

    // POST /admin/gemaild — afvinken wat verstuurd is
    if (request.method === 'POST' && path === '/admin/gemaild') {
      const body = await request.json();
      const data = await getData();
      const auth = validateCode(data, body.code);
      if (!auth || auth.role !== 'admin') return json({ error: 'Geen toegang' }, 403);
      if (!Array.isArray(body.sleutels)) return json({ error: 'Geef `sleutels` mee' }, 400);

      const opslag = JSON.parse(await env.AANWEZIGHEID.get('nietgekomen') || '{}');
      const gemaild = opslag.gemaild || {};
      const nu = new Date().toISOString();
      for (const sleutel of body.sleutels) gemaild[sleutel] = nu;
      const klaar = (opslag.klaar || []).filter((r) => !gemaild[r.sleutel]);
      await env.AANWEZIGHEID.put('nietgekomen',
        JSON.stringify({ ...opslag, gemaild, klaar }));
      return json({ ok: true, afgevinkt: body.sleutels.length, resterend: klaar.length });
    }

    return json({ error: 'Not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    // Wekelijkse back-up, zondag 03:00.
    if (event.cron === '0 3 * * SUN') {
      const raw = await env.AANWEZIGHEID.get('data');
      if (raw) {
        const date = new Date().toISOString().slice(0, 10);
        await env.AANWEZIGHEID.put(`backup:${date}`, raw);
      }
      return;
    }

    // Afmeldingen om 10:00 Nederlandse tijd -- de uiterste afmeldtijd van de
    // dag. De cron van Cloudflare draait op UTC en dat is 's zomers een uur
    // naast onze tijd, dus hij vuurt om 08:00 en 09:00 UTC en we laten er
    // hier eentje door.
    if (!isTienUurInAmsterdam()) return;
    ctx.waitUntil(draaiAfmeldingen(env, { schrijf: true }));
  },
};
