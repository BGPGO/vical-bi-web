#!/bin/sh
# download-xlsx.sh — baixa os XLSX da VICAL do Supabase Storage pro container.
#
# Supabase bucket: bi-excel / vical-caixa
# Local paths: /app/workspace/bases/ (adapter lê daqui)
# Requer env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY.

set -e

TS() { date '+%Y-%m-%d %H:%M:%S'; }

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_KEY" ]; then
  echo "[$(TS)] download-xlsx: SUPABASE_URL ou SUPABASE_SERVICE_KEY nao definido — pulando"
  exit 0
fi

BUCKET="bi-excel"
PREFIX="vical-caixa"
BASES_DIR="/app/workspace/bases"
mkdir -p "$BASES_DIR"

download() {
  local supa_file="$1"
  local local_path="$2"

  local status=$(curl -s -o "$local_path" -w "%{http_code}" \
    "${SUPABASE_URL}/storage/v1/object/${BUCKET}/${PREFIX}/${supa_file}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    -H "apikey: ${SUPABASE_SERVICE_KEY}")

  if [ "$status" = "200" ]; then
    echo "[$(TS)]   ok: $(basename "$local_path")"
  else
    echo "[$(TS)]   FAIL ($status): ${PREFIX}/${supa_file}"
    rm -f "$local_path"
  fi
}

echo "[$(TS)] download-xlsx: baixando bases VICAL..."
download "vical-brasil.xlsx"        "${BASES_DIR}/extrato_financeiroVicalBrasil.xlsx"
download "vical-instrumentos.xlsx"  "${BASES_DIR}/extrato_financeiroVicalinstrumentos.xlsx"

echo "[$(TS)] download-xlsx: concluido"
