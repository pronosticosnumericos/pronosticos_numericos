// meteograma.js
(function () {
  // ===== Config de rutas =====
  const REPO = 'pronosticos_numericos';
  const BASE = location.pathname.startsWith('/' + REPO + '/') ? ('/' + REPO) : '';
  const DATA_BASE  = `${BASE}/data/meteogram`;
  const MODEL_DIR  = 'wrf';
  const CITIES_URL = `${DATA_BASE}/${MODEL_DIR}/cities.json`;

  // ===== DOM =====
  const $ = (id) => document.getElementById(id);
  const PANEL = $('meteoPanel');
  const DD_CITY = $('citySelect');
  const TITLE = $('mtTitle');
  const META  = $('mtMeta');
  const RANGE_BADGE = $('mtRange');
  const LINK = $('deepLink');

  const CANVAS = {
    temp: $('cTemp'),
    ppn:  $('cPpn'),
    wind: $('cWind'),
    rh:   $('cRh'),
  };

  // ===== Estado =====
  let CITIES = [];
  let LAST = null;

  // ===== Utils =====
  function fmtDateRange(timestamps) {
    if (!timestamps?.length) return '—';
    const a = new Date(timestamps[0]);
    const b = new Date(timestamps[timestamps.length - 1]);
    const pad = (n) => String(n).padStart(2, '0');
    const fa = `${a.getFullYear()}-${pad(a.getMonth()+1)}-${pad(a.getDate())} ${pad(a.getHours())}h`;
    const fb = `${b.getFullYear()}-${pad(b.getMonth()+1)}-${pad(b.getDate())} ${pad(b.getHours())}h`;
    return `${fa} → ${fb}`;
  }
  function findCityBySlug(slug) { return CITIES.find(c => c.slug === slug) || CITIES[0]; }
  function qsEncode(obj) { const p = new URLSearchParams(); Object.keys(obj||{}).forEach(k=>p.append(k,obj[k])); return p.toString(); }
  const isValidDateStr = (s) => !isNaN(new Date(s).getTime());

  // ===== Carga de datos =====
  async function fetchCityJson(slug) {
    const url = `${DATA_BASE}/${MODEL_DIR}/${slug}.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' al cargar ' + url);
    return res.json();
  }
  async function loadCities() {
    try {
      const res = await fetch(CITIES_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      CITIES = await res.json();
    } catch (e) {
      console.warn('[meteograma] No se pudo cargar cities.json -> usando fallback:', e);
      CITIES = [
        { name:'Ciudad de México', slug:'ciudad-de-mexico', lat:19.433, lon:-99.133 },
        { name:'Veracruz', slug:'veracruz', lat:19.1738, lon:-96.1342 },
        { name:'Guadalajara', slug:'guadalajara', lat:20.6736, lon:-103.344 }
      ];
    }
  }

  function normalizePayload(slug, raw) {
    const safe = (k, fb=[]) => Array.isArray(raw[k]) ? raw[k] : fb;
    const ts = Array.isArray(raw.timestamps) ? raw.timestamps.filter(isValidDateStr) : [];
    const fb = findCityBySlug(slug) || {name: slug, lat: 0, lon: 0};
    const out = {
      city: raw.city ?? fb.name,
      lat:  (typeof raw.lat === 'number') ? raw.lat : fb.lat,
      lon:  (typeof raw.lon === 'number') ? raw.lon : fb.lon,
      timestamps: ts,
      temp:   safe('temp'),
      precip: safe('precip'),
      wind:   safe('wind'),
      rh:     safe('rh'),
    };
    const n = Math.min(out.timestamps.length, out.temp.length, out.precip.length, out.wind.length, out.rh.length);
    out.timestamps = out.timestamps.slice(0, n);
    out.temp   = out.temp.slice(0, n);
    out.precip = out.precip.slice(0, n);
    out.wind   = out.wind.slice(0, n);
    out.rh     = out.rh.slice(0, n);
    return out;
  }

  // ===== Canvas helpers =====
  function clearCanvas(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function linMap(x, x0, x1, y0, y1) { return x1 === x0 ? y0 : y0 + (y1 - y0) * ((x - x0) / (x1 - x0)); }

  function findMinMax(arr) {
    let mn=+Infinity, mx=-Infinity;
    for (const v of arr || []) { if(v<mn) mn=v; if(v>mx) mx=v; }
    if (!isFinite(mn) || !isFinite(mx)) { mn=0; mx=1; }
    if (mn===mx) { mn-=1; mx+=1; }
    return [mn,mx];
  }

  function niceStep(raw) {
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    if (n <= 1.2) return 1 * pow;
    if (n <= 2.5) return 2 * pow;
    if (n <= 3.5) return 2.5 * pow;
    if (n <= 7.5) return 5 * pow;
    return 10 * pow;
  }

  // padding “bonito” alrededor de min/max
  function expandRange(min, max, {padFrac=0.12, minSpan=1, floor0=false, ceil100=false}={}) {
    let span = Math.max(max - min, minSpan);
    let pad = span * padFrac;
    let a = min - pad, b = max + pad;
    if (floor0) a = Math.max(0, a);   // ← importante: nunca bajar de 0
    if (ceil100) b = Math.min(100, b); // ← y no subir de 100
    if (b - a < minSpan) {
      const extra = (minSpan - (b - a)) / 2;
      a -= extra; b += extra;
    }
    const step = niceStep((b - a) / 4);
    a = Math.floor(a / step) * step;
    b = Math.ceil(b / step) * step;
    return [a, b, step];
  }

  // formateo de ticks evitando duplicados cuando step es fraccional
  function formatTick(v, step) {
    const absStep = Math.abs(step);
    if (absStep >= 1) return String(Math.round(v));
    if (absStep >= 0.1) return (Math.round(v*10)/10).toFixed(1);
    return (Math.round(v*100)/100).toFixed(2);
  }

  function drawYTicks(ctx, rect, min, max, unit, step) {
    ctx.fillStyle='#667085';
    ctx.font='12px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial';
    ctx.textAlign='right'; ctx.textBaseline='middle';
    ctx.strokeStyle='#f1f5f9'; ctx.lineWidth=1;

    // Evita acumular el último por error de punto flotante
    const eps = step/1000;
    for (let v = min; v <= max + eps; v += step) {
      // normaliza v a múltiplos exactos de step para evitar 0.999999
      const k = Math.round((v - min) / step);
      const vv = min + k * step;

      const y = linMap(vv, min, max, rect.y+rect.h, rect.y);
      ctx.beginPath(); ctx.moveTo(rect.x, y + 0.5); ctx.lineTo(rect.x+rect.w, y + 0.5); ctx.stroke();
      ctx.fillText(`${formatTick(vv, step)}${unit||''}`, rect.x - 6, y);
    }
  }

  function drawXLabels(ctx, rect, timestamps) {
    if (!timestamps?.length) return;
    if (isNaN(new Date(timestamps[0]).getTime())) return;
    const n = timestamps.length;
    const maxLabels = Math.max(3, Math.floor(rect.w / 90));
    const step = Math.max(1, Math.floor(n / maxLabels));
    ctx.fillStyle = '#667085';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = 0; i < n; i += step) {
      const d = new Date(timestamps[i]);
      const label = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}h`;
      const x = linMap(i, 0, n - 1, rect.x, rect.x + rect.w);
      ctx.fillText(label, x, rect.y + rect.h + 6);
    }
  }

  function drawLineSeries(ctx, xs, ys, color, rect) {
    const n = Math.min(xs.length, ys.length); if (n<=0) return;
    ctx.save();
    ctx.beginPath();
    for (let i=0;i<n;i++) {
      const x = linMap(i, 0, n-1, rect.x, rect.x+rect.w);
      const yRaw = linMap(ys[i], rect.yMin, rect.yMax, rect.y+rect.h, rect.y);
      const y = clamp(yRaw, rect.y+1, rect.y+rect.h-1);
      if (i===0) ctx.moveTo(x+0.5, y+0.5); else ctx.lineTo(x+0.5, y+0.5);
    }
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.stroke();
    ctx.restore();
  }

  function drawBars(ctx, xs, ys, color, rect, {minBarPx=2}={}) {
    const n = Math.min(xs.length, ys.length); if (n<=0) return;
    const gap=2, bw=Math.max(1,(rect.w/n)-gap);
    ctx.fillStyle=color;

    // Base en el CERO real del eje
    const yZero = linMap(0, rect.yMin, rect.yMax, rect.y + rect.h, rect.y);

    for (let i=0;i<n;i++){
      const v = ys[i];
      const x = linMap(i,0,n-1,rect.x,rect.x+rect.w) - bw/2;

      const yVal = linMap(v, rect.yMin, rect.yMax, rect.y + rect.h, rect.y);
      let top    = Math.min(yZero, yVal);
      let height = Math.abs(yZero - yVal);

      if (v > 0 && height < minBarPx) {
        height = minBarPx;
        if (yVal < yZero) top = yZero - height;
      }
      ctx.fillRect(x, top, bw, height);
    }
  }

  // === renderChart con DPI, padding y "nice ranges" ===
  function renderChart(canvas, data, opts) {
    if (!canvas) return;

    if (canvas.clientHeight < 180) canvas.style.minHeight = '200px';

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth  || 300;
    const cssH = canvas.clientHeight || 180;
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(dpr, dpr);
    const w = cssW, h = cssH;

    clearCanvas(ctx, w, h);

    const padding = { l: 56, r: 12, t: 16, b: 44 };
    const rect = { x: padding.l, y: padding.t, w: w - padding.l - padding.r, h: h - padding.t - padding.b };

    // Marco
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x+0.5, rect.y+0.5, rect.w-1, rect.h-1);

    // Datos
    const rawYs = data.values || [];
    const tYs = rawYs.slice(); // lineal clásico

    // Min/Max base
    const [mn0, mx0] = (opts.lockMinMax && tYs.length)
      ? [opts.lockMinMax[0], opts.lockMinMax[1]]
      : findMinMax(tYs);

    // --- Rango Y ---
    let mn, mx, step;

    if (opts.lockMinMax) {
      // Respeta exactamente el rango bloqueado (p. ej., RH 0–100)
      mn = opts.lockMinMax[0];
      mx = opts.lockMinMax[1];
      step = niceStep((mx - mn) / 4);
    } else if (opts.type === 'bar' && (opts.floor0 || mn0 >= 0)) {
      // Barras no negativas: base 0, padding arriba
      const minSpan = opts.minSpan ?? 1;
      const topSpan = Math.max(mx0 - 0, minSpan);
      const padTop  = topSpan * 0.12;
      mn = 0;
      mx = Math.max(mx0, topSpan) + padTop;
      [mn, mx, step] = expandRange(mn, mx, { padFrac: 0, minSpan, floor0: true });
    } else {
      // Líneas normales
      [mn, mx, step] = expandRange(mn0, mx0, {
        padFrac: 0.12,
        minSpan: opts.minSpan ?? 1,
        floor0 : !!opts.floor0,
        ceil100: !!opts.ceil100
      });
    }

    // Clamps de seguridad
    if (opts.floor0 && mn < 0) mn = 0;
    if (opts.ceil100 && mx > 100) mx = 100;

    const view = { ...rect, yMin: mn, yMax: mx };

    drawYTicks(ctx, view, mn, mx, opts.unit, step);

    if (opts.type === 'bar') {
      drawBars(ctx, data.timestamps || [], rawYs, opts.color || '#94a3b8', view, { minBarPx: 2 });
    } else {
      drawLineSeries(ctx, data.timestamps || [], tYs, opts.color || '#334155', view);
    }

    drawXLabels(ctx, view, data.timestamps || []);
  }

  // ===== UI panel =====
  function openPanel() { PANEL.classList.add('open'); }
  function closePanel() { PANEL.classList.remove('open'); }
  $('closeBtn')?.addEventListener('click', closePanel);

  function fillCitiesSelect() {
    if (!DD_CITY) return;
    DD_CITY.innerHTML = '';
    CITIES.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.slug; opt.textContent = c.name;
      DD_CITY.appendChild(opt);
    });
  }

  // ===== Cargar y pintar =====
  async function loadAndRender(slug) {
    const raw = await fetchCityJson(slug);
    const dat = normalizePayload(slug, raw);
    LAST = dat;

    TITLE.textContent = `Meteograma — ${dat.city}`;
    META.textContent  = `Lat ${(+dat.lat).toFixed(3)}, Lon ${(+dat.lon).toFixed(3)}`;
    RANGE_BADGE.textContent = fmtDateRange(dat.timestamps);
    LINK.href = `?${qsEncode({ model: MODEL_DIR, city: slug })}#meteograma`;

    renderChart(CANVAS.temp, {timestamps: dat.timestamps, values: dat.temp},   {
      unit:'°C', type:'line', color:'#2563eb', minSpan: 8
    });

    const maxP = Math.max(...dat.precip, 0);
    renderChart(CANVAS.ppn,  {timestamps: dat.timestamps, values: dat.precip}, {
      unit:'mm/h', type:'bar', color:'#60a5fa',
      floor0:true,
      minSpan: Math.max(2, maxP*0.5)
    });

    renderChart(CANVAS.wind, {timestamps: dat.timestamps, values: dat.wind},   {
      unit:'km/h', type:'line', color:'#10b981',
      floor0:true, minSpan: 6
    });

    renderChart(CANVAS.rh,   {timestamps: dat.timestamps, values: dat.rh},     {
      unit:'%', type:'line', color:'#f59e0b',
      lockMinMax:[0,100]   // RH fijo 0–100
    });
  }

  function rerenderFromLast(){
    if (!LAST) return;
    renderChart(CANVAS.temp, {timestamps: LAST.timestamps, values: LAST.temp},   { unit:'°C', type:'line', color:'#2563eb', minSpan:8 });
    const maxP = Math.max(...LAST.precip, 0);
    renderChart(CANVAS.ppn,  {timestamps: LAST.timestamps, values: LAST.precip}, { unit:'mm/h', type:'bar', color:'#60a5fa', floor0:true, minSpan: Math.max(2, maxP*0.5) });
    renderChart(CANVAS.wind, {timestamps: LAST.timestamps, values: LAST.wind},   { unit:'km/h', type:'line', color:'#10b981', floor0:true, minSpan:6 });
    renderChart(CANVAS.rh,   {timestamps: LAST.timestamps, values: LAST.rh},     { unit:'%', type:'line', color:'#f59e0b', lockMinMax:[0,100] });
  }

  // ===== API pública & wiring =====
  window.Meteo = {
    open: async function (slug) {
      if (!CITIES.length) await loadCities();
      if (!slug) slug = (CITIES[0]?.slug || 'ciudad-de-mexico');
      if (DD_CITY) DD_CITY.value = slug;
      openPanel();
      await loadAndRender(slug);
    }
  };

  if (DD_CITY) {
    DD_CITY.addEventListener('change', async function () {
      await loadAndRender(this.value);
    });
  }

  // ===== Init =====
  document.addEventListener('DOMContentLoaded', async function () {
    await loadCities();
    fillCitiesSelect();

    const sp = new URLSearchParams(location.search);
    const slug = sp.get('city') || (CITIES[0]?.slug ?? 'ciudad-de-mexico');

    document.getElementById('openMeteograma')?.addEventListener('click', function(){
      window.Meteo.open(slug);
    });

    if (location.hash === '#meteograma') {
      if (DD_CITY) DD_CITY.value = slug;
      window.Meteo.open(slug);
    }

    const host = document.getElementById('meteoPanel');
    if (host) {
      const ro = new ResizeObserver(() => rerenderFromLast());
      ro.observe(host);
    }
    window.addEventListener('resize', rerenderFromLast);
    window.addEventListener('orientationchange', rerenderFromLast);
  });
})();

