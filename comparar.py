#!/usr/bin/env python3
# Verifica meteograma vs WRF en un (lat,lon)
import json, glob, math
import xarray as xr
import numpy as np
from wrf import getvar, ll_to_xy

# --- ENTRADAS (ajusta) ---
WRF_FILES = sorted(glob.glob("/home/sig07/WRF/ARWpost/wrfout_d01_*"))  # mismos usados para mapas
CITY_JSON = "/home/sig07/pronosticos_numericos/data/meteogram/wrf/acapulco.json"
LAT, LON  = 16.863, -99.890           # debe coincidir con el JSON
TZ_OFFSET_H = 0                        # si todo está en UTC, deja 0

# --- LEE JSON meteograma ---
m = json.load(open(CITY_JSON))
t_js  = np.array(m["timestamps"], dtype="datetime64[m]")
T_js  = np.array(m["temp"], dtype=float)
P_js  = np.array(m["precip"], dtype=float)
W_js  = np.array(m["wind"], dtype=float)
RH_js = np.array(m["rh"], dtype=float)

# --- LEE WRF y arma timeseries en el MISMO punto que el mapa ---
ds = xr.open_mfdataset(WRF_FILES, combine="nested", concat_dim="Time")
# Coordenadas del grid (para nearest):
XLAT = getvar(ds, "XLAT", meta=False)[0]
XLONG= getvar(ds, "XLONG", meta=False)[0]
j,i  = ll_to_xy(ds, LAT, LON)  # indices enteros nearest

# Variables (mismas que en mapas)
T2   = getvar(ds, "T2", meta=False)[:, j, i]          # K
U10  = getvar(ds, "U10", meta=False)[:, j, i]         # m s-1
V10  = getvar(ds, "V10", meta=False)[:, j, i]         # m s-1
RAIN = (getvar(ds, "RAINC", meta=False)+getvar(ds,"RAINNC", meta=False))[:, j, i]  # mm acumulada

# Tiempos
t_wr = xr.decode_cf(ds).Time.values.astype("datetime64[m]") + np.timedelta64(TZ_OFFSET_H, 'h')

# Derivados
T2C  = T2 - 273.15
W10  = np.sqrt(U10**2 + V10**2) * 3.6  # km/h
P_h  = np.insert(np.diff(RAIN), 0, 0)  # mm/h aprox; asegúrate de paso 1h en tus datos
P_h  = np.where(P_h < 0, np.nan, P_h)  # reseteos o reinicios -> NaN

# (Opcional) RH2: si en mapas usas getvar("rh2"), usa lo mismo aquí
try:
    RH2 = getvar(ds, "rh2", meta=False)[:, j, i]
except:
    RH2 = np.full_like(T2C, np.nan)

# --- Empareja tiempos (intersección exacta a minuto) ---
# Si tus meteogramas están a las mismas marcas temporales, basta con:
mask = np.isin(t_wr, t_js)
t_wr2, T2C2, W102, P_h2, RH22 = t_wr[mask], T2C[mask], W10[mask], P_h[mask], RH2[mask]

# Ordena JSON por si acaso
ord_js = np.argsort(t_js)
t_js2, T_js2, W_js2, P_js2, RH_js2 = t_js[ord_js], T_js[ord_js], W_js[ord_js], P_js[ord_js], RH_js[ord_js]

# Alinea índices por tiempo
idx_wr = {str(t):k for k,t in enumerate(t_wr2)}
pairs  = [ (idx_wr.get(str(t)), i) for i,t in enumerate(t_js2) if str(t) in idx_wr ]
wr_i, js_i = zip(*pairs) if pairs else ([],[])

def mae(a,b): return float(np.nanmean(np.abs(np.array(a)-np.array(b))))

print("N puntos comparados:", len(wr_i))
print("MAE Temp (°C):", mae(T2C2[wr_i], T_js2[js_i]))
print("MAE Viento (km/h):", mae(W102[wr_i], W_js2[js_i]))
print("MAE Ppn (mm/h):", mae(P_h2[wr_i], P_js2[js_i]))
if not np.all(np.isnan(RH22[wr_i])):
    print("MAE RH (%):", mae(RH22[wr_i], RH_js2[js_i]))

