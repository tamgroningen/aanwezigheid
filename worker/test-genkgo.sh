#!/bin/sh
# Test of het Genkgo-integratietoken werkt en wat het mag.
#
#   GENKGO_API_TOKEN=<token> sh test-genkgo.sh
#
# Het token komt uit de omgeving, staat dus niet in dit bestand.

[ -z "$GENKGO_API_TOKEN" ] && { echo "Zet GENKGO_API_TOKEN."; exit 1; }

API=https://tam.genkgo.app/_/integration/api/v1

probe() {
  printf '%-46s ' "$1"
  code=$(curl -s -o /tmp/genkgo-body -w '%{http_code}' \
    -H "X-Api-Token: $GENKGO_API_TOKEN" \
    -H 'Accept: application/json' "$API$1")
  echo "$code"
  head -c 400 /tmp/genkgo-body; echo; echo
}

probe /me/user
probe /organization/entry
probe "/organization/entry?resource%5Bparent%5D=8&recursive=1"
