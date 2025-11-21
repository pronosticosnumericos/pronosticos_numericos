#!/usr/bin/env bash
set -euo pipefail

SRC_BASE="/home/sig07/ECMWF/ecmwf_out/mex"
DST_BASE="/home/sig07/pronosticos_numericos"

# Subcarpetas esperadas (PRCP.py)
declare -a SUBS=( "tp_interval" "tp_total" "tp_24h" "t2m" "wind10" )

log(){ printf "[%s] %s\n" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }

choose_run_dir() {
  local run=""

  # 1) Prioriza symlink 'latest' si existe y apunta a algo válido con PNGs
  if [[ -L "$SRC_BASE/latest" || -d "$SRC_BASE/latest" ]]; then
    local cand
    cand="$(readlink -f "$SRC_BASE/latest" || true)"
    if [[ -n "$cand" && -d "$cand" ]]; then
      # ¿Hay al menos un PNG en alguna subcarpeta conocida?
      if find "$cand" -maxdepth 2 -type f -name '*.png' | grep -q .; then
        run="$cand"
      fi
    fi
  fi

  # 2) Si no, toma el run más reciente por mtime que tenga PNGs
  if [[ -z "$run" ]]; then
    # /mex/YYYY/MM/<run>/
    local listed
    mapfile -t listed < <(ls -1dt "$SRC_BASE"/*/*/*/ 2>/dev/null || true)
    for d in "${listed[@]}"; do
      if find "$d" -maxdepth 2 -type f -name '*.png' | grep -q .; then
        run="$d"; break
      fi
    done
  fi

  [[ -n "$run" ]] || { log "ERROR: No encontré una corrida con PNGs en $SRC_BASE"; exit 2; }
  echo "$run"
}

copy_flat() {
  local src_run="$1"
  mkdir -p "$DST_BASE"

  for sub in "${SUBS[@]}"; do
    local src="$src_run/$sub"
    local dst="$DST_BASE"

    # Mapea nombres de salida (coinciden con tu index.html)
    local outname=""
    case "$sub" in
      tp_interval) outname="tpInt" ;;
      tp_total)    outname="tpTotal" ;;
      tp_24h)      outname="tp24" ;;
      t2m)         outname="t2m" ;;
      wind10)      outname="wind10" ;;
      *)           outname="$sub" ;;
    esac

    local dst_dir="$dst/$outname"

    if [[ -d "$src" ]]; then
      mkdir -p "$dst_dir"
      # Si hay PNGs, copia; si no, limpia destino para no dejar frames obsoletos
      if find "$src" -maxdepth 1 -type f -name '*.png' | grep -q .; then
        log "COPIANDO ${sub} → ${outname}"
        rsync -a --delete --info=NAME,STATS,PROGRESS "$src"/ "$dst_dir"/
      else
        log "WARN: ${sub} sin PNGs; limpio destino ${outname}"
        rsync -a --delete --info=NAME,STATS "$src"/ "$dst_dir"/
      fi
    else
      log "WARN: no existe $src (omitido)"
    fi
  done
}

main() {
  log "Buscando última corrida…"
  local run_dir
  run_dir="$(choose_run_dir)"
  log "RUN elegido: $run_dir"
  copy_flat "$run_dir"
  log "DONE: contenido actualizado en $DST_BASE"
}

main "$@"

