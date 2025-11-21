# Pronósticos Numéricos

Sitio estático con productos WRF y meteogramas por ciudad.

## Contenido
- `index4.html` (UI principal)
- `meteograma.js` (gráficas en canvas del meteograma)
- `meteos.py` (extracción de series desde wrfout a JSON por ciudad)
- Páginas de variables: `precipitacion*.html`, `temperatura2.html`, `viento.html`, `humedadrelativa.html`, etc.
- Directorios con imágenes: `tmp/`, `prcp/`, `prcpacum/`, `prcpacum24h/`, `rh2m/`, `wind/`, `windsaffir/`
- Datos meteograma: `data/meteogram/wrf/*.json` (opcional)

> GitHub limita archivos >100 MB. Evita subir NetCDF/WRF crudos o usa almacenamiento externo.
