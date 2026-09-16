# Aanwezigheidsapp TAM

Presentielijst voor de tennistrainingen van TAM Groningen. Trainers vinken per
training aan wie er was; de trainingsleider ziet alles en beheert de koppeling
met Genkgo. De cijfers bepalen de trainingsboetes, een post van rond de 8.000
euro per jaar, dus verlies of een verkeerd bericht is hier duurder dan traag.

Het doel waar alles op gericht is: **Niels en Daphne vullen de trainingsgroepen
in Genkgo in, en de rest gaat vanzelf.** Floris hoeft er niet elke keer met zijn
IT-kennis aan te pas te komen. Kom je iets tegen dat dat doel ondergraaft, dan
is dat een bug, ook als niemand erom vraagt.

## LET OP: openstaand beveiligingsprobleem

Deze repo is **openbaar** (github.com/tamgroningen/aanwezigheid). Tot
16-09-2026 stond `const ADMIN_PASSWORD = 'training2026'` gewoon in
`worker/index.js`, en de Worker-URL staat in `publiek/index.html`. Met die twee
kon iedereen alle veertien `/admin`-eindpunten aanroepen, waaronder
`/admin/export` (alle ledennamen en trainerscodes), `/admin/niet-gekomen` met
`adressen: true` (haalt live mailadressen op bij Genkgo) en `/admin/wis-toekomst`.

De code leest het wachtwoord nu uit `env.ADMIN_PASSWORD` en weigert alles als
dat secret ontbreekt. **Nog te doen zolang dit hier staat:**

1. `cd worker && npx wrangler secret put ADMIN_PASSWORD` met een **nieuw**
   wachtwoord. `training2026` is verbrand, dat staat in de geschiedenis van een
   openbare repo.
2. `npx wrangler deploy`.
3. Scripteigenschap `ADMIN_CODE` in het Apps Script bijwerken.
4. De nieuwe code aan Niels en Daphne doorgeven.

Is dit gedaan, haal deze sectie dan weg. Wachtwoorden typ je niet zelf in
formulieren, dat doet Floris.

## Waar wat draait

| Onderdeel | Waar | Uitrollen |
| --- | --- | --- |
| Frontend | Deno Deploy, org `tam`, app `aanwezigheid`, op aanwezigheid.tam.nl | `deno deploy --prod publiek` vanuit de projectmap, met `DENO_DEPLOY_TOKEN` van Floris |
| Worker | Cloudflare `aanwezigheid-sync`, account `tam-floris` | `npx wrangler deploy` vanuit `worker/` |
| Verzender | Apps Script onder **fiscus@tam.nl**, project-id `11a3FKRaTlrc-d5XNrjikWethk2qhpmmuJx5guOJ4nSOJp_ISpW-x69n2` | plakken in de editor, zie de valkuilen hieronder |

KV-namespace `AANWEZIGHEID`, id `e1a81333d90f4976b13fd7dd877a732d`, met de
sleutels `data` (alles), `afmeldingen`, `nietgekomen` en `backup:<datum>`.

Crons in `wrangler.toml`: `0 3 * * SUN` (kopie naar KV) en `0 8,9 * * *`, waarvan
`isTienUurInAmsterdam()` er eentje doorlaat zodat de afmeldingen om 10:00
Nederlandse tijd worden opgehaald, zomer en winter.

## Regels die uit het clubbeleid komen, niet uit de code

Bron: https://tam.nl/tennis/training/trainingsboetes

- **Afmelden kan tot 09:00 uur** op de dag van de training. Niet 10:00. Tien uur
  is alleen het moment waarop wij de afmeldingen ophalen, een uur na de
  deadline. Dit is eerder op zes plekken door elkaar gehaald.
- 5 euro per gemiste training zonder afmelding, maximaal drie keer per
  trainingsmoment. Dus 15 euro bij een training per week, 30 euro bij twee.
- Mist iemand in een ronde niet meer dan drie trainingen van een
  trainingsmoment, dan worden de boetes **kwijtgescholden**.
- De begrotingstoelichting voor de OALV zegt nog "tot 10:00 uur afmelden". Dat
  is nog niet rechtgezet.

## De mail aan wie niet kwam opdagen

Gaat vanaf fiscus@tam.nl, dagelijks om 11:00, een uur na de ophaalronde.
Onderwerp "Afwezig training \<dag\>". Eronder de vaste handtekening van de
fiscus, met het TAM-logo als PNG in de mail zelf.

De selectie maakt de Worker, niet het script:

- Een regel ontstaat alleen voor een training die de trainer **al heeft
  ingevuld**. Een lege training zegt niets.
- Iemand komt pas op de verzendlijst als hij **24 uur onveranderd op afwezig
  staat**. Dat wordt niet met tijdstempels gemeten maar door de meting van
  vandaag te vergelijken met die van gisteren (`vorige` versus `huidig` in
  `werkNietGekomenBij`). Een trainer die halverwege het invullen is stuurt dus
  niemand iets, en de 24 uur begint te lopen bij het invullen, niet op de dag
  van de training.
- De sleutel is `groepId|datum|speler`. Staat die in `gemaild`, dan komt hij
  nooit meer terug.
- `MAIL_VENSTER_DAGEN = 21`: nooit mailen over oudere trainingen. Dat is een
  noodrem, want `groepId` komt van de groepsnaam, en hernoemen in Genkgo zou
  anders de hele historie opnieuw mailbaar maken.
- `data.mailAan === false` (de checkbox in de instellingen) laat
  `/admin/niet-gekomen` een lege lijst teruggeven. Het script vinkt dan ook
  niets af, dus wat er tijdens het uitzetten bijkomt gaat later alsnog mee.

Het Apps Script haalt **eerst alle pagina's op en verstuurt daarna pas**, en
vinkt **per bericht meteen** af. Beide zijn bewust: afvinken verandert de lijst
bij de Worker, en KV is niet meteen overal bijgewerkt, dus doorbladeren tijdens
het versturen leverde dubbele of overgeslagen regels op. Lukt het afvinken niet,
dan stopt de run. Draai dat niet terug.

Mailadressen worden per run bij Genkgo opgehaald en nergens bewaard; de app
slaat van spelers alleen naam en persoonsnummer op.

## Back-ups

Drie kopieën bij drie partijen, allemaal op zondag:

| Waar | Door |
| --- | --- |
| Cloudflare KV, `backup:<datum>` | de Worker zelf, 03:00 |
| Drive, map *Aanwezigheid trainingen* (gedeelde drive, id `13xIpjVi3aHWHZ40jZXzSW9UGYasELxUL`) | `backupNaarDrive` in het Apps Script, 04:00 |
| `backups/` op Floris' laptop | `scripts/backup-lokaal.sh` via launchd, 04:00 |

De kopie in KV staat in dezelfde namespace als de live gegevens en is dus geen
echte back-up. Behandel de andere twee als de echte.

## Koppeling met Genkgo

- Integratie-API `https://tam.genkgo.app/_/integration/api/v1`, alleen lezen,
  token in het secret `GENKGO_API_TOKEN` (lokaal `worker/.env.local`).
- `PLANNING_MAP = 3433`. `vindTrainingsronde()` loopt Planning → seizoen
  (`/^\d{4}-\d{4}$/`) → Training → trainingsronde en telt de groepen per ronde.
  Hij blijft op de opgeslagen ronde zolang die groepen heeft en kiest nooit een
  lege ronde. Daardoor loopt het jaarlijks door en breekt het niet als Niels de
  indeling over een paar dagen uitsmeert.
- Afmeldingen komen niet uit de API maar van de beheerpagina, via
  `worker/afmeldingen.js` met de cookies `gsitesess1` en `gadminsess`
  (`GENKGO_UID` / `GENKGO_PASSWORD` als secrets).
- **Bekende bug:** Genkgo zet afzeggers en overnemers in één kolom. De parser
  telt die nog door elkaar, zo'n 16 namen. Trap er niet in dat iemand zich heeft
  afgemeld terwijl hij juist een training overnam.
- De indeling wordt **niet** automatisch overgenomen. Iemand klikt Controleren
  en daarna Toepassen. Dat is met opzet: je wilt zien wat er verandert. Dat is
  de enige handmatige stap die overblijft.

## Valkuilen die tijd hebben gekost

**Uitrollen frontend.** Alleen `publiek/` uitrollen, vanuit de goede map, en
`Deno.serve` mag geen vaste poort binden. Zie de losse memory
`aanwezigheid-deploy-valkuilen`.

**Cloudflare rolt geleidelijk uit.** De eerste 10 tot 30 seconden na
`wrangler deploy` beantwoorden oude en nieuwe versies door elkaar. Een nieuw
eindpunt dat "Not found" geeft betekent dus niets; probeer opnieuw. Dit heeft
een keer een schakelaar op de verkeerde stand achtergelaten.

**launchd.** Zie de memory `launchd-node-valkuil`. Kort: node staat niet op de
PATH van launchd, en de node in `/usr/local/bin` is te oud voor wrangler. Test
met `env -i HOME=$HOME USER=$USER PATH=/usr/bin:/bin:/usr/sbin:/sbin ...`.

**De Apps Script-editor.** De functiekiezer reageert niet op klikken vanuit
browserautomatisering, hoe je de coördinaten ook omrekent. Wat wel werkt:

- Plakken lukt alleen na een **echte muisklik** in de editor. Focus zetten met
  JavaScript is niet genoeg.
- Schermafbeeldingcoördinaten zijn niet de coördinaten van de pagina. Reken om
  met `frame / window.innerWidth` (was 1381/1300).
- Controleer achteraf met `monaco.editor.getModels()[0].getValue()`, niet met
  `innerText`: de editor rendert alleen wat in beeld staat.
- Na opslaan springt de functiekiezer terug naar de eerste functie. De knop
  Uitvoeren werkt wel gewoon. Laat het kiezen van een functie dus aan Floris.

**Cloudflare staat 50 subrequests per aanroep toe.** Daarom haalt
`/admin/niet-gekomen` hoogstens 45 personen per keer op en knipt hij de pagina
af op de regel waar de 46e persoon zou beginnen. Simpelweg de eerste 45 regels
pakken ging mis: dan komen er regels mee van iemand die er niet bij zat en die
krijgen geen adres.

## Schrijfstijl

Nederlands, geen em-dashes (dat leest als AI), "TAM" en niet "T.A.M.",
ondertekenen met "Met sportieve groet, Bestuur 63 der Tennisclub Albertus
Magnus". Korte zinnen, geen ingewikkelde constructies. Commentaar in de code
legt uit *waarom* iets zo is, niet wat de regel doet.

## Nog open

- Het beveiligingsprobleem bovenaan.
- De overnemers-parser in `afmeldingen.js`.
- De begrotingstoelichting voor de OALV zegt nog 10:00 in plaats van 09:00.
- Het mailadres van Kristjan Liiv ontbreekt in de trainerslijst
  (`docs/trainers-genkgo.csv`).
- Frans Wouters heeft nog trainingen openstaan.
- Bij Genkgo navragen of losse trainersaccounts met eenmalige aanmelding kunnen,
  en melden dat "Download voorbeeld" bij de importfunctie een interne fout geeft.
