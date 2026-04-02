# TAM Aanwezigheid

Aanwezigheidstool voor trainingen bij TAM Groningen. Trainers voeren presentie in, de trainingsleider ziet het totaaloverzicht automatisch.

## Hoe werkt het?

### Rollen

- **Trainingsleider (admin)** — Beheert trainers, groepen, spelers en lesdagen. Ziet het volledige overzicht met aanwezigheidspercentages per speler.
- **Trainer** — Logt in met persoonlijke code. Ziet alleen eigen groepen. Vinkt per lesdag aan welke spelers aanwezig waren.

### Aanwezigheid invoeren (trainer)

1. Ga naar https://tamgroningen.github.io/aanwezigheid/
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
