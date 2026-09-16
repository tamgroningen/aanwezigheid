#!/bin/zsh
# Wekelijkse back-up van de presentie naar deze laptop.
#
# De kopie die de Worker zelf maakt staat in dezelfde KV-namespace als de live
# gegevens. Die helpt tegen een verkeerde bewerking, niet tegen het kwijtraken
# van de namespace. Daarom deze, en daarnaast een kopie op Drive.
#
# Draait via launchd, zie scripts/nl.tam.aanwezigheid.backup.plist. Handmatig:
#   ~/projects/tam/aanwezigheid/scripts/backup-lokaal.sh

set -euo pipefail

MAP=${0:a:h:h}
NS=e1a81333d90f4976b13fd7dd877a732d
UIT=$MAP/backups
DATUM=$(date +%Y-%m-%d)

mkdir -p $UIT
cd $MAP/worker

haal() {
  npx --yes wrangler kv key get --remote --namespace-id $NS "$1" 2>/dev/null
}

TMP=$(mktemp)
{
  print -n '{"gemaakt":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","data":'
  haal data
  print -n ',"afmeldingen":'
  haal afmeldingen
  print -n ',"nietgekomen":'
  haal nietgekomen
  print -n '}'
} > $TMP

# Pas overschrijven als het geldige json is. Een halve back-up is erger dan
# geen, want die vervangt stilletjes de vorige.
if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" $TMP; then
  echo "BACK-UP MISLUKT: ongeldige json, oude bestanden blijven staan" >&2
  rm -f $TMP
  exit 1
fi

mv $TMP $UIT/aanwezigheid-$DATUM.json
chmod 600 $UIT/aanwezigheid-$DATUM.json
echo "back-up klaar: $UIT/aanwezigheid-$DATUM.json ($(wc -c < $UIT/aanwezigheid-$DATUM.json) bytes)"
