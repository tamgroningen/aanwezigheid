# TAM Aanwezigheid

Aanwezigheidstool voor trainingen bij TAM Groningen. Trainers voeren presentie in, de trainingsleider ziet het totaaloverzicht automatisch.

## Hoe werkt het?

### Rollen

- **Trainingsleider (admin)** — Beheert trainers, groepen, spelers en lesdagen. Ziet het volledige overzicht met aanwezigheidspercentages per speler.
- **Trainer** — Logt in met persoonlijke code. Ziet alleen eigen groepen. Vinkt per lesdag aan welke spelers aanwezig waren.

### Aanwezigheid invoeren (trainer)

1. Ga naar https://aanwezigheid.tam.nl
2. Log in met je trainerscode
3. Klik op een trainingsgroep
4. Vink per datum de aanwezige spelers aan — wijzigingen worden automatisch opgeslagen

### Beheer (trainingsleider)

1. Log in met de admincode
2. Op de hoofdpagina kun je:
   - Trainers toevoegen/verwijderen
   - Per trainer groepen aanmaken (dag, tijd, speelsterkte, selectie, periode)
   - Spelers en lesdagen per groep bewerken
   - Lesdagen als vervallen markeren (klik op de datum-chip)
3. Klik op "Volledig overzicht per speler" voor een tabel met percentages per speler

### Kleuren

- **Groen**: >75% aanwezigheid
- **Geel**: 50-75% aanwezigheid
- **Rood**: <50% aanwezigheid

Percentages worden berekend op basis van lesdagen tot en met vandaag (toekomstige lessen tellen niet mee).

## Architectuur

- **Frontend**: Statische single-page app (`index.html` + `style.css`) gehost op GitHub Pages
- **Backend**: Cloudflare Worker (`worker/index.js`) met KV storage
- **Data**: Opgeslagen als JSON in Cloudflare KV namespace `AANWEZIGHEID`

## Backups

Elke zondag om 03:00 UTC maakt de Cloudflare Worker automatisch een backup van alle data. Backups worden opgeslagen in dezelfde KV namespace onder de key `backup:YYYY-MM-DD`.

### Backups bekijken

Alle backups oplijsten:

```bash
npx wrangler kv key list --namespace-id e1a81333d90f4976b13fd7dd877a732d | grep backup
```

Een specifieke backup downloaden:

```bash
npx wrangler kv key get backup:2026-04-06 --namespace-id e1a81333d90f4976b13fd7dd877a732d
```

Een backup opslaan als bestand:

```bash
npx wrangler kv key get backup:2026-04-06 --namespace-id e1a81333d90f4976b13fd7dd877a732d > backup.json
```

### Backup herstellen

Om een backup terug te zetten als actieve data:

```bash
npx wrangler kv key put data --namespace-id e1a81333d90f4976b13fd7dd877a732d --path backup.json
```

## Deployment

### Worker deployen

```bash
cd worker
npx wrangler deploy
```

### Site updaten

Push naar `main` branch — GitHub Pages deployt automatisch.

```bash
git add .
git commit -m "beschrijving"
git push
```

## De indeling komt uit Genkgo

Sinds 10 september 2026 wordt de trainingsindeling niet meer uit een Excel
overgetypt maar uit Genkgo gelezen. De trainingsgroepen staan daar onder

```
Organisatie > Planning > 2026-2027 > Training > Trainingsronde 1
```

en dragen alles wat deze app nodig heeft in hun profiel: `x_Trainer`,
`x_tijd`, `x_speelsterkte`, `x_baan` en `capacity`. De id van de
trainingsronde staat in de worker (`TRAININGSRONDE`, TR1 2026-2027 = 18095)
en is te overschrijven met de omgevingsvariabele `GENKGO_TRAININGSRONDE`.

### Een nieuwe trainingsronde

1. Maak de groepen in Genkgo aan onder de nieuwe trainingsronde.
2. Zet `GENKGO_TRAININGSRONDE` op de id van die ronde.
3. Proefdraaien -- dit verandert niets en geeft alleen het plan terug:

```
curl -s -X POST $WORKER/admin/sync \
  -H 'Content-Type: application/json' -d '{"code":"<adminwachtwoord>"}'
```

4. Ziet het plan goed uit, dan dezelfde aanroep met `"apply": true`.

De sync schrijft eerst een `backup:voor-sync-<tijd>` in KV. Aanwezigheid,
afgelaste data, totalen en trainerscodes blijven staan. De lesdagen hoef je
niet meer te zetten: die komen uit de planning in Genkgo. De app leest ze uit
de afmeldingen die elke ochtend om 10:00 worden opgehaald, en valt terug op
wat er in de app staat als die planning ontbreekt.

### Wat de sync met opzet niet doet

**Groepen verwijderen.** Een app-groep die in Genkgo niet meer bestaat wordt
gemeld als `niet-in-genkgo` en blijft staan -- er hangt aanwezigheids-
geschiedenis aan.

**Trainers aanmaken of verplaatsen.** `x_Trainer` is vrije tekst in Genkgo.
Een typefout daarin ("Philipa" in plaats van "Philippa") zou anders stil een
tweede trainer met een nieuwe inlogcode opleveren, terwijl de oude code naar
een lege lijst wijst. Onbekende trainers komen in `overgeslagen` te staan;
alleen met `"trainers": true` mag de sync ze aanmaken.

### Namen

Genkgo levert doopnamen ("Tjalle Reinder Hartmans"). De app gebruikt de
roepnaam: eerste voornaam, tussenvoegsel als het er echt een is, achternaam.
`middlename` in Genkgo is namelijk niet consequent het tussenvoegsel -- er
staan net zo vaak extra voornamen in. Staat een naam volledig in kleine
letters, dan krijgt hij hoofdletters; staat er al ergens een hoofdletter, dan
blijven we eraf (anders wordt "Lycklama à Nijeholt" een "Lycklama À
Nijeholt").

Elke speler krijgt zijn Genkgo-persoonsnummer mee in `playerIds`. Daardoor
herkent de sync een naamswijziging als een hernoeming en werkt die ook de al
ingevulde aanwezigheid bij, in plaats van iemand stil op afwezig te zetten.
`playerIds` gaat niet mee in de publieke `/data`.

### Toegang

Het lezen gaat via het serviceaccount **API aanwezigheid** (Beheerders, cid
19369) met de rol **API lezen** (cid 19370): alleen Organisatie -> Lezen en
Lezen boomstructuur, geen Inloggen Admin. Het token staat als
Cloudflare-secret `GENKGO_API_TOKEN` en is in Genkgo opnieuw te genereren op
de Toegang-tab van dat account, waarmee het oude direct vervalt.

Let op: Cloudflare staat 50 subverzoeken per aanroep toe. De sync doet er
1 + het aantal groepen; het profiel van een groep zit al in de recursieve
boomlijst, dus daar hoeft geen apart verzoek voor.

### Herstellen

```
curl -s -X POST $WORKER/admin/backups -d '{"code":"..."}'
curl -s -X POST $WORKER/admin/restore -d '{"code":"...","key":"backup:..."}'
```

`restore` schrijft eerst de huidige stand weg als `backup:voor-herstel-<tijd>`.
Let op: Cloudflare KV is eventueel consistent -- een `/data` direct na een
schrijfactie kan nog de oude stand geven. Even wachten en opnieuw lezen.

`/admin/herstel-namen` bestaat voor het eenmalige geval dat vinkjes na een
naamswijziging los zijn geraakt. Bij de eerste sync had nog geen speler een
Genkgo-nummer, dus toen was dat nodig. Daarna niet meer.

## Waar de app staat

De pagina staat op **https://aanwezigheid.tam.nl**, bij Deno Deploy in de
organisatie `tam` (app `aanwezigheid`, regio Europe/ams). De gegevens komen
van de Cloudflare Worker; Deno levert alleen `index.html`, `style.css` en
`logo.webp` uit.

Waarom niet GitHub Pages, waar het eerst stond: de Genkgo-sessiecookie staat
op `domain=tam.nl` en gaat dus mee naar elk subdomein. Een lid dat de pagina
opent, stuurt daarmee zijn ingelogde tam.nl-sessie naar de host van dat
subdomein. Bij Deno blijft die binnen infrastructuur van de vereniging.

Deployen:

```
DENO_DEPLOY_TOKEN=<token> deno deploy --prod publiek
```

**Die laatste `publiek` is geen detail.** De nieuwe `deno deploy`, de opvolger
van `deployctl`, leest de `include` en `exclude` uit `deno.json` niet meer en
uploadt standaard alles onder de map die je opgeeft. Laat je `publiek` weg,
dan gaan `worker/.env.local` met het Genkgo-token, `worker/index.js` met het
adminwachtwoord en `backups/` met ledennamen en trainerscodes gewoon mee. Op
16-09-2026 gebeurde dat: 65 bestanden in plaats van 3. Die revisie mislukte en
is nooit uitgerold, maar de les staat.

Daarom liggen de drie publieke bestanden in een eigen map `publiek/`. Alles
wat daarin ligt is openbaar opvraagbaar, alles daarbuiten kan niet mee. Zet er
dus niets anders in.

Twee dingen die op 16-09-2026 een uur kostten, voor wie hier weer staat:

**Sta in de goede map.** `deno deploy --prod publiek` gedraaid vanuit je home
of een ander project uploadt niets, meldt vrolijk "Successfully deployed" en
zet de site op 404. Je herkent het aan "No files were changed, so there is
nothing to upload" en aan een `deno.jsonc` die hij in die verkeerde map
achterlaat. Gooi zo'n achtergelaten bestand weg: het koppelt die map aan deze
app, en de volgende deploy daarvandaan haalt de site opnieuw onderuit. Goed
gaat het als er **4 bestanden** worden geüpload.

**Geef `Deno.serve` geen vaste poort.** Deno Deploy kiest zelf een poort en
luistert daar mee. Bind je aan bijvoorbeeld 8000, dan draait de app wel maar
slaagt de gezondheidscheck nooit en blijft de uitrol hangen op "warming".
Lokaal geef je `PORT` mee, want 8000 is daar vaak bezet.

`--org` en `--app` staan in `deno.json`. De app draait in **static mode**:
Deno levert de bestanden uit `publiek/` uit en start geen server. `server.js`
staat in de projectmap voor het geval we later serverlogica nodig hebben
(bijvoorbeeld inloggen met de TAM-sessie in plaats van met een trainerscode);
dan moet de bouwinstelling in de console van static naar dynamic met
`server.js` als entrypoint. Hij serveert uit diezelfde map `publiek/`, zodat
lokaal draaien en uitrollen hetzelfde doen.

### DNS

Twee CNAME's in het Genkgo-DNS-paneel (Hosting -> DNS -> tam.nl), naar
hetzelfde model als `od.tam.nl`:

```
aanwezigheid.tam.nl.                 CNAME  alias.deno.net.
_acme-challenge.aanwezigheid.tam.nl. CNAME  <hash>._acme.deno.net.
```

De hash krijg je van Deno Deploy bij het toevoegen van het domein. Daarna in
de console het certificaat aanvragen (Automatic certificate ->
Provision certificate).
