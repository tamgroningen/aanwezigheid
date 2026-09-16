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

### Instellingen en uitleg

De trainingsleider heeft rechtsboven een knop **Instellingen**. Daar staat de
status (wanneer de afmeldingen voor het laatst zijn opgehaald, welke ronde
draait, hoeveel trainingen er openstaan, en waarschuwingen zoals een groep
zonder planning), de knop om de indeling uit Genkgo te halen, en uitleg over
hoe alles samenhangt: waar de gegevens vandaan komen, wat er vanzelf gebeurt,
wat je doet bij een nieuwe ronde of een nieuwe trainer, en wat te doen als er
iets misgaat.

Die pagina is bedoeld voor Niels, Daphne en hun opvolgers, zodat de app niet
afhangt van wie hem gebouwd heeft. Verandert er iets aan de werking, werk dan
ook die tekst bij.

### Niet gekomen zonder afmelding

Op de instellingenpagina staat een lijst van spelers die er niet waren en zich
ook niet hadden afgemeld. Bedoeld om ze een bericht te sturen vanaf
fiscus@tam.nl, met de strekking: je was er niet en je had je niet afgemeld,
was je er wel dan graag even contact met je trainer, en meld je voortaan af
zodat iemand anders je plek kan overnemen.

**De 24-uursregel.** Iemand komt pas op die lijst als hij 24 uur onveranderd
op afwezig staat. Dat wordt niet met tijdstempels gemeten maar door de
ochtendmeting te vergelijken met die van de dag ervoor: staat iemand in
allebei, dan is het beeld een dag stabiel. Zo krijgt een trainer die nog
midden in het invullen zit, of die zich vertikt heeft, de tijd om het te
herstellen voordat er iets de deur uit gaat. Het werkt ook voor de trainer die
pas een week later invult, want de 24 uur begint te lopen bij het invullen en
niet op de dag van de training.

Wie gemaild is wordt afgevinkt (`/admin/gemaild`), zodat niemand twee keer
hetzelfde bericht krijgt.

**Mailadressen staan niet in deze app.** Ze worden pas bij het versturen bij
Genkgo opgehaald, via `/admin/niet-gekomen` met `"adressen": true`. Cloudflare
staat 50 subverzoeken per aanroep toe, dus dat gaat in stukken: het antwoord
bevat `rest`, en met `vanaf` haal je het volgende stuk op.

**Versturen gebeurt nog met de hand.** Genkgo kan dit niet automatisch: de
integratie-API heeft geen mail-endpoint en het token is alleen-lezen. De
mailboxen van tam.nl draaien op Google Workspace en de SPF van tam.nl staat
Google al toe, dus de logische volgende stap is een Google Apps Script onder
het TAM-account dat dagelijks de lijst ophaalt, verstuurt als fiscus@tam.nl en
terugmeldt wat er weg is. Dan komen antwoorden ook in die mailbox terecht.

### Eindoverzicht

Aan het eind van een trainingsronde geeft **Eindoverzicht** een afdrukbaar
overzicht, per trainer of per speler. De kolommen zijn Aanwezig, Afgemeld,
Meegeteld en het percentage: het percentage rekent over de meegetelde
trainingen, want wie zich netjes afmeldt valt uit zijn eigen noemer. Is er
niets meegeteld, dan staat er een streepje in plaats van 0%.

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

## Mails aan spelers die niet kwamen opdagen

De verzender is een Apps Script onder **fiscus@tam.nl**, project [TAM
trainingsmails niet gekomen](https://script.google.com/u/6/home/projects/11a3FKRaTlrc-d5XNrjikWethk2qhpmmuJx5guOJ4nSOJp_ISpW-x69n2/edit). De broncode staat in `appsscript/Code.gs`; die
map is de kopie die je bewerkt, het origineel draait bij Google.

Hoe het loopt:

1. De Worker haalt om 10:00 de afmeldingen op en zet in KV (`nietgekomen`) wie
   er afwezig was zonder afmelding, in een training die de trainer al heeft
   ingevuld.
2. Iemand komt pas op de verzendlijst als hij 24 uur onveranderd op afwezig
   staat. Dat meet de Worker door de meting van vandaag met die van gisteren te
   vergelijken, dus een trainer die halverwege het invullen is stuurt geen
   mails de deur uit.
3. Het Apps Script draait dagelijks om 11:00, haalt de lijst met adressen op
   bij `/admin/niet-gekomen`, verstuurt, en vinkt af via `/admin/gemaild`.

Scripteigenschappen: `WORKER_URL`, `ADMIN_CODE`, `TEST_MAIL`.

Functies in het script: `verstuurNietGekomen` (de dagelijkse run),
`proefdraaien` (laat in het logboek zien wie er aan de beurt is, verstuurt
niets), `testbericht` (stuurt één voorbeeld naar `TEST_MAIL`), `zetTrigger`
(zet de dagelijkse trigger, eenmalig).

Onder elk bericht staat de vaste handtekening van fiscus@tam.nl, met het
TAM-logo als PNG in de mail zelf. Wisselt het bestuur, dan pas je bovenin
`Code.gs` de drie regels `FISCUS_NAAM`, `FISCUS_BESTUUR` en `FISCUS_TELEFOON`
aan.

In de instellingen van de app staat een schakelaar **Automatische
afwezigheidsmail aan**. Uit betekent dat de Worker een lege lijst teruggeeft,
dus het script vinkt ook niets af en wat er intussen binnenkomt gaat alsnog mee
zodra hij weer aan staat.

Mailadressen worden per run bij Genkgo opgehaald en nergens bewaard. Staat er
geen adres bij Genkgo, dan wordt de regel niet afgevinkt en komt hij morgen
terug.

## Back-ups

De presentie bepaalt de trainingsboetes, een post van rond de 8.000 euro per
jaar. Daarom liggen er drie kopieën, bij drie verschillende partijen.

| Waar | Wanneer | Door |
| --- | --- | --- |
| Cloudflare KV, sleutel `backup:<datum>` | zondag 03:00 | de Worker zelf |
| Google Drive, map *TAM aanwezigheid back-ups* onder fiscus@tam.nl | zondag 04:00 | `backupNaarDrive` in het Apps Script |
| Deze laptop, `backups/aanwezigheid-<datum>.json` | zondag 04:00 | `scripts/backup-lokaal.sh` via launchd |

De kopie in KV staat in dezelfde namespace als de live gegevens. Die helpt tegen
een verkeerde bewerking, niet tegen het kwijtraken van de namespace zelf.
Daarom staan de andere twee ergens anders.

De lokale back-up activeren:

```
launchctl load -w ~/Library/LaunchAgents/nl.tam.aanwezigheid.backup.plist
```

Kopieer daarvoor `scripts/nl.tam.aanwezigheid.backup.plist` naar
`~/Library/LaunchAgents/`. Handmatig draaien kan altijd met
`scripts/backup-lokaal.sh`. Het script gebruikt je eigen wrangler-aanmelding,
er staat dus geen wachtwoord in.

`backups/` staat bewust in `.gitignore`: er staan ledennamen en trainerscodes
in, en die horen niet in een repo.

Terugzetten gaat met `wrangler kv key put --remote --namespace-id <ns> data
--path <bestand>`, waarbij je het `data`-deel uit de json haalt.
