#!/usr/bin/env bash
# guarda como link_ecmwf.sh en /home/sig07/pronosticos_numericos/website
set -euo pipefail

SRC="/home/sig07/ECMWF/ecmwf_out/mex"
DST="/home/sig07/pronosticos_numericos"

link_series () {
  local pattern="$1"   # ej. wx_tpInt_*_H*.png
  local outdir="$2"    # ej. $DST/tpInt
  mkdir -p "$outdir"
  local n=1
  # Ordena por H###
  for f in $(ls -1 "$SRC"/$pattern 2>/dev/null | sort -tH -k2,2n); do
    cp -f "$f" "$outdir/$n.png"
    n=$((n+1))
  done
  echo "OK: $(basename "$outdir") → $((n-1)) frames"
}

link_series "wx_tpInt_*_H*.png"    "$DST/tpInt"
link_series "wx_tpTotal_*_H*.png"  "$DST/tpTotal"
link_series "wx_tp24_*_H*.png"     "$DST/tp24"
link_series "wx_t2m_*_H*.png"      "$DST/t2m"
link_series "wx_w10_*_H*.png"      "$DST/wind10"

