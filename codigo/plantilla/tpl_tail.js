const $ = s => document.querySelector(s);
function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
  ));
}
function mil(n) { return Math.round(n || 0).toLocaleString("es-CO"); }
function fmtDist(m) {
  return m >= 1000 ? (m / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1 }) + " km" : mil(m) + " m";
}

/* ---------------- disponibilidad de cupos ---------------- */
// color de cada UDS en el mapa/tabla: por disponibilidad de cupos (verde/
// rojo), no por banda de distancia -- a pedido del usuario, para que de
// un vistazo se vea cual UDS cercana realmente tiene espacio.
const COLOR_CON_CUPOS = "#5FA829", COLOR_SIN_CUPOS = "#D64545";
function disponibles(p) { return (p.cu || 0) - (p.at || 0); }
function colorCupos(p) { return disponibles(p) > 0 ? COLOR_CON_CUPOS : COLOR_SIN_CUPOS; }
function chipCupos(p) {
  const d = disponibles(p);
  return d > 0
    ? '<span class="chip-cupos con">' + mil(d) + " disponibles</span>"
    : '<span class="chip-cupos sin">Sin cupos</span>';
}

/* ---------------- tabla generica ordenable ---------------- */
function tabla(cols, filas, opt) {
  opt = opt || {};
  let sortCol = opt.sortCol != null ? opt.sortCol : 0;
  let sortAsc = opt.sortAsc !== false;
  const wrap = el("div", "tabla-scroll");
  function pinta() {
    wrap.innerHTML = "";
    const t = el("table", "tabla");
    const thead = el("thead");
    const trh = el("tr");
    cols.forEach((c, i) => {
      const th = el("th", null, esc(c.label) + (i === sortCol ? '<span class="ar">' + (sortAsc ? "↑" : "↓") + "</span>" : ""));
      th.onclick = () => {
        if (sortCol === i) sortAsc = !sortAsc;
        else { sortCol = i; sortAsc = c.numeric === false; }
        pinta();
      };
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    t.appendChild(thead);
    const filasOrd = filas.slice().sort((a, b) => {
      const c = cols[sortCol];
      let va = c.get(a), vb = c.get(b);
      if (typeof va === "string") {
        va = va.toLowerCase(); vb = (vb || "").toLowerCase();
        return sortAsc ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0);
      }
      va = va || 0; vb = vb || 0;
      return sortAsc ? va - vb : vb - va;
    });
    const tbody = el("tbody");
    filasOrd.forEach(f => {
      const tr = el("tr");
      if (opt.getId) tr.dataset.id = String(opt.getId(f));
      if (opt.onRowClick) { tr.classList.add("fila-clicable"); tr.onclick = () => opt.onRowClick(f); }
      cols.forEach(c => {
        const td = el("td", c.numeric === false ? null : "num", c.fmt ? c.fmt(f) : esc(c.get(f)));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
    wrap.appendChild(t);
  }
  pinta();
  return wrap;
}

/* ---------------- geometria ---------------- */
function distMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
// puntos de un circulo de radioM metros centrado en lat/lon (aproximacion
// plana: suficiente precision a escala de unos pocos/decenas de km).
function circuloPuntos(lat, lon, radioM, n) {
  n = n || 72;
  const mPorGradoLat = 111320, mPorGradoLon = 111320 * Math.cos(lat * Math.PI / 180);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const ang = (i / n) * 2 * Math.PI;
    pts.push([lat + (radioM * Math.cos(ang)) / mPorGradoLat, lon + (radioM * Math.sin(ang)) / mPorGradoLon]);
  }
  return pts;
}

/* ---------------- pin: caida con rebote ---------------- */
// mismo patron que el tablero de Medellin (ver GEORREF/codigo, 2026-08-20):
// setTimeout, NUNCA requestAnimationFrame -- rAF deja de dispararse si la
// pestana/pane pierde foco o queda oculta a medio salto y el pin se queda
// congelado en el aire, a metros del punto real.
function easeOutBounce(t) {
  const n1 = 7.5625, d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}
function animarCaidaPin(marker, destino, mapInst) {
  const ALTURA_CAIDA = 90, DURACION = 550;
  const destPt = mapInst.latLngToLayerPoint(destino);
  const t0 = performance.now();
  function paso() {
    const t = Math.min(1, (performance.now() - t0) / DURACION);
    const y = destPt.y - ALTURA_CAIDA + ALTURA_CAIDA * easeOutBounce(t);
    marker.setLatLng(mapInst.layerPointToLatLng(L.point(destPt.x, y)));
    if (t < 1) setTimeout(paso, 16);
    else marker.setLatLng(destino);
  }
  paso();
}

/* ---------------- busqueda de cercania ---------------- */
// radio adaptativo: en zonas urbanas 500 m ya trae varias UDS; en zonas
// rurales dispersas del departamento un radio fijo de 500 m puede no traer
// ninguna, asi que se va ampliando hasta juntar al menos MIN_RESULTADOS (o
// hasta el tope de RADIOS_BUSQUEDA, lo que pase primero).
const RADIOS_BUSQUEDA = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
const MIN_RESULTADOS = 5;

function buscarCercanas(lat, lon) {
  const conD = D.puntos
    .map(p => ({ p, d: distMetros(lat, lon, p.y, p.x) }))
    .sort((a, b) => a.d - b.d);
  let radioFinal = RADIOS_BUSQUEDA[RADIOS_BUSQUEDA.length - 1];
  for (const r of RADIOS_BUSQUEDA) {
    if (conD.filter(x => x.d <= r).length >= MIN_RESULTADOS) { radioFinal = r; break; }
  }
  return { items: conD.filter(x => x.d <= radioFinal), radioFinal };
}

// 3 bandas proporcionales al radio final de esta busqueda puntual (no un
// radio fijo como en el tablero de Medellin): el mismo concepto de
// "cerca / media / lejos" funciona igual de bien a 1,5 km que a 80 km.
function bandasDe(radioFinal) {
  const b1 = radioFinal / 3, b2 = (radioFinal * 2) / 3;
  return [
    { max: b1, label: "A menos de " + fmtDist(b1), color: "#5FA829", fill: "#9AD16A", fillOpacity: 0.22 },
    { max: b2, label: "Entre " + fmtDist(b1) + " y " + fmtDist(b2), color: "#0B6FA8", fill: "#7FC3EA", fillOpacity: 0.18 },
    { max: radioFinal, label: "Entre " + fmtDist(b2) + " y " + fmtDist(radioFinal), color: "#7B3FA0", fill: "#C4A3D9", fillOpacity: 0.15 },
  ];
}
function bandaDe(d, bandas) {
  return bandas.find(b => d <= b.max) || bandas[bandas.length - 1];
}

/* ---------------- estado del mapa/busqueda ---------------- */
let MAPA = null;
let MUNI = null;        // municipio seleccionado (objeto de D.municipios)
let PUNTO = null;       // {lat, lon} del punto marcado
let MARKER = null;
let ANILLOS = [];
let RES_MARKERS = [];
let MARCADOR_POR_ID = {};
let BANDAS_ACTUALES = [];
let POLIGONO_MUNI = null;   // contorno real del municipio elegido (si el geojson lo trae)
let TODOS_MUNICIPIOS_LAYER = null;  // contorno tenue de los 124/125 municipios, siempre visible

// mismo mascote SVG que la pestana (favicon), reutilizado como icono del pin
// de referencia: la forma es una gota, punta hacia abajo en ~92% del alto.
const ICONO_PIN = L.icon({
  iconUrl: "data:image/svg+xml;base64,__FAVICON_B64__",
  iconSize: [46, 46],
  iconAnchor: [23, 42],
  popupAnchor: [0, -38]
});

function dibujarPoligonoMunicipio() {
  if (!MAPA) return null;
  if (POLIGONO_MUNI) { MAPA.removeLayer(POLIGONO_MUNI); POLIGONO_MUNI = null; }
  if (!MUNI || !MUNI.poligono) return null;
  POLIGONO_MUNI = L.polygon(MUNI.poligono, {
    color: "#2F6B10", weight: 2.5, fillColor: "#5FA829", fillOpacity: 0.08, interactive: false,
  }).addTo(MAPA);
  return POLIGONO_MUNI;
}

// contorno de TODOS los municipios con poligono (124/125, ver generar_datos_
// cercania.py -- Medellin no tiene poligono municipal en esa fuente) a la
// vez, tenue/no interactivo, para que el mapa sirva de referencia general
// y se pueda ubicar el pin a mano sin tener que elegir municipio primero.
// El contorno del municipio elegido (dibujarPoligonoMunicipio, mas arriba)
// se dibuja encima con trazo mas marcado.
function dibujarTodosMunicipios() {
  if (!MAPA) return;
  const anillos = [];
  D.municipios.forEach(m => { if (m.poligono) anillos.push(...m.poligono); });
  TODOS_MUNICIPIOS_LAYER = L.polygon(anillos, {
    color: "#2F6B10", weight: 1.5, opacity: .8, fillOpacity: 0, interactive: false,
    dashArray: "1 5", lineCap: "round",
  }).addTo(MAPA);
}

function initMapaBase() {
  const div = $("#mapaCerc");
  // si Leaflet no cargo (CDN bloqueado por el navegador/antivirus, o sin
  // internet), no truena todo init() -- se avisa en el propio recuadro del
  // mapa y el resto de la pagina (selector de municipio, fuentes) sigue
  // funcionando. MAPA queda null; colocarPin/dibujarAnillos/etc. ya
  // comprueban MAPA antes de usarlo.
  if (typeof L === "undefined") {
    div.innerHTML = '<p class="nota" style="padding:16px">No se pudo cargar el mapa (la librería Leaflet, desde unpkg.com, no llegó a cargar). Revisa la conexión a internet o si algo la está bloqueando (antivirus, firewall corporativo). El resto de la página sigue funcionando.</p>';
    return;
  }
  const map = L.map(div, { scrollWheelZoom: true });
  MAPA = map;
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18, attribution: "© OpenStreetMap",
  }).addTo(map);
  map.invalidateSize();
  const bb = D.bbox_depto; // [oeste, sur, este, norte]
  // animate:false: mismo motivo que en colocarPin (ver mas abajo) -- si el
  // encuadre inicial queda animandose de fondo, el pixel origin que usa la
  // caida del pin (llamada justo despues, mas abajo) queda desactualizado.
  map.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]], { padding: [4, 4], animate: false });
  dibujarTodosMunicipios();
  // el mapa siempre es interactivo, con o sin municipio elegido -- quien
  // ya sabe donde queda su punto puede simplemente hacer clic sin pasar
  // por el selector de arriba (el selector sigue siendo el camino guiado,
  // pero deja de ser obligatorio para poder usar el mapa).
  map.on("click", (e) => {
    PUNTO = { lat: e.latlng.lat, lon: e.latlng.lng };
    $("#estadoDir").textContent = "Punto marcado manualmente en el mapa.";
    $("#candidatosDir").innerHTML = "";
    colocarPin(true);
    buscarYPintar();
  });
  // pin por defecto ya puesto desde el arranque, en Medellin (capital del
  // departamento), draggable de una, para quien solo quiere arrastrarlo a
  // su punto sin elegir municipio ni escribir nada. mantenerVista=true: a
  // diferencia de colocarPin() normal, el encuadre inicial (fitBounds de
  // arriba, todo el departamento) no se toca -- se ve Antioquia completo
  // con el pin ya puesto en Medellin dentro de esa vista, no un zoom
  // cercano centrado ahi.
  const medellin = D.municipios.find(m => m.nombre === "MEDELLIN");
  PUNTO = medellin ? { lat: medellin.centro[0], lon: medellin.centro[1] } : { lat: (bb[1] + bb[3]) / 2, lon: (bb[0] + bb[2]) / 2 };
  colocarPin(false, true);
  buscarYPintar();
}

function colocarPin(zoomCerca, mantenerVista) {
  if (zoomCerca == null) zoomCerca = true;
  if (!PUNTO || !MAPA) return;
  if (MARKER) MAPA.removeLayer(MARKER);
  ANILLOS.forEach(a => MAPA.removeLayer(a));
  ANILLOS = [];
  // animate:false: si el setView queda animandose de fondo, el pixel origin
  // usado para calcular la caida del pin (mas abajo) queda desactualizado y
  // el pin termina cayendo lejos del punto real (gotcha ya documentado en
  // el tablero de Medellin).
  // zoomCerca=false tambien pone un piso de zoom 12 (no solo "lo que haya
  // dado fitBounds"): en municipios grandes el fitBounds a todo el
  // poligono puede quedar tan alejado que el pin y los resultados cercanos
  // se amontonan unos sobre otros y tapan las etiquetas del mapa base.
  // mantenerVista=true (solo lo usa el pin por defecto en Medellin, ver
  // initMapaBase) se salta este setView del todo -- el encuadre ya puesto
  // por quien llamo (p.ej. el departamento completo) no se toca.
  if (!mantenerVista) {
    const zoomDestino = zoomCerca ? Math.max(MAPA.getZoom(), 14) : Math.max(MAPA.getZoom(), 12);
    MAPA.setView([PUNTO.lat, PUNTO.lon], zoomDestino, { animate: false });
  }
  const destino = L.latLng(PUNTO.lat, PUNTO.lon);
  const destPt = MAPA.latLngToLayerPoint(destino);
  const inicio = MAPA.layerPointToLatLng(L.point(destPt.x, destPt.y - 90));
  MARKER = L.marker(inicio, { draggable: true, icon: ICONO_PIN }).addTo(MAPA);
  MARKER.bindPopup("Punto de referencia<br>arrastra el pin para ajustarlo");
  MARKER.on("dragend", () => {
    const p = MARKER.getLatLng();
    PUNTO = { lat: p.lat, lon: p.lng };
    buscarYPintar();
  });
  animarCaidaPin(MARKER, destino, MAPA);
}

function dibujarAnillos(bandas) {
  if (!MAPA) return;
  ANILLOS.forEach(a => MAPA.removeLayer(a));
  ANILLOS = [];
  if (!PUNTO) return;
  const lat = PUNTO.lat, lon = PUNTO.lon;
  // de la banda mas exterior a la mas interior, para que el borde de la mas
  // cercana quede encima y se vea nitido.
  bandas.slice().reverse().forEach((b, i) => {
    const radioInt = i === bandas.length - 1 ? 0 : bandas[bandas.length - 2 - i].max;
    const radioExt = b.max;
    const externo = circuloPuntos(lat, lon, radioExt);
    const anillo = radioInt > 0
      ? L.polygon([externo, circuloPuntos(lat, lon, radioInt)], { color: b.color, weight: 2, fillColor: b.fill, fillOpacity: b.fillOpacity })
      : L.circle([lat, lon], { radius: radioExt, color: b.color, weight: 2, fillColor: b.fill, fillOpacity: b.fillOpacity });
    anillo.addTo(MAPA);
    anillo.bindTooltip(fmtDist(radioExt), { direction: "top" });
    ANILLOS.push(anillo);
  });
}

function abrirPopup(id) {
  const m = MARCADOR_POR_ID[id];
  if (!m || !MAPA) return;
  const div = $("#mapaCerc");
  // scroll instantaneo, no "smooth": el scroll animado por el navegador
  // depende de un loop interno tipo rAF que en este sitio ya se sabe que
  // se puede congelar si la pestana pierde foco a medio salto (mismo
  // gotcha que animarCaidaPin, ver arriba) -- mas vale un salto seco que
  // uno que a veces simplemente no ocurre.
  if (div) div.scrollIntoView({ block: "center" });
  MAPA.setView(m.getLatLng(), Math.max(MAPA.getZoom(), 15), { animate: false });
  m.openPopup();
}

// camino inverso a abrirPopup(): clic en un punto del mapa -> ubica su fila
// en "Resultados" (id != null, puesto por tabla() via opt.getId), abre su
// grupo de banda si estaba colapsado, hace scroll y la resalta un momento.
function resaltarFila(id) {
  if (id == null) return;
  const tr = Array.from(document.querySelectorAll("#resultados tr[data-id]"))
    .find(t => t.dataset.id === String(id));
  if (!tr) return;
  const grupo = tr.closest("details.grupo-banda");
  if (grupo && !grupo.open) grupo.open = true;
  tr.scrollIntoView({ block: "center" }); // ver nota de scroll instantaneo en abrirPopup()
  tr.classList.add("fila-resaltada");
  setTimeout(() => tr.classList.remove("fila-resaltada"), 1800);
}

function pintarLeyendaCupos() {
  // fija (no depende de la busqueda): los pines/puntos del mapa y de la
  // tabla se colorean por disponibilidad de cupos, no por que tan lejos
  // esta cada UDS (eso ya lo dice el titulo de cada grupo desplegable).
  const ley = $("#leyendaBandas");
  ley.innerHTML =
    '<span><i class="pt" style="background:' + COLOR_CON_CUPOS + '"></i>Con cupos disponibles</span>' +
    '<span><i class="pt" style="background:' + COLOR_SIN_CUPOS + '"></i>Sin cupos disponibles (llena)</span>';
}

// los campos de Latitud/Longitud reflejan SIEMPRE el punto marcado, sin
// importar como se haya puesto (municipio, direccion, clic, arrastre o los
// campos mismos) -- unica funcion que los toca, llamada desde el punto
// donde todos esos caminos ya convergen (buscarYPintar, mas abajo).
function actualizarLatLon() {
  if (!PUNTO) return;
  const inputLat = $("#inputLat"), inputLon = $("#inputLon");
  if (document.activeElement !== inputLat) inputLat.value = PUNTO.lat.toFixed(6);
  if (document.activeElement !== inputLon) inputLon.value = PUNTO.lon.toFixed(6);
}

function buscarYPintar() {
  const resWrap = $("#resultados");
  const sub = $("#subResultados");
  RES_MARKERS.forEach(m => MAPA && MAPA.removeLayer(m));
  RES_MARKERS = [];
  MARCADOR_POR_ID = {};
  if (!PUNTO) {
    resWrap.innerHTML = '<p class="nota">Elige un municipio y marca un punto para ver las unidades de servicio más cercanas.</p>';
    sub.textContent = "";
    ANILLOS.forEach(a => MAPA && MAPA.removeLayer(a));
    ANILLOS = [];
    return;
  }
  actualizarLatLon();
  const { items, radioFinal } = buscarCercanas(PUNTO.lat, PUNTO.lon);
  const bandas = bandasDe(radioFinal);
  BANDAS_ACTUALES = bandas;
  dibujarAnillos(bandas);
  sub.textContent = items.length
    ? items.length + (items.length === 1 ? " unidad de servicio" : " unidades de servicio") + " en un radio de " + fmtDist(radioFinal)
    : "";

  if (!items.length) {
    resWrap.innerHTML = '<p class="nota">No se encontró ninguna UDS con coordenada en un radio de ' + fmtDist(radioFinal) + ' de ese punto.</p>';
  } else {
    resWrap.innerHTML = "";
    const cols = [
      { label: "Código", get: x => x.p.id != null ? String(x.p.id) : "—", numeric: false },
      { label: "Nombre UDS", get: x => x.p.n || "(sin nombre)", numeric: false },
      { label: "Entidad", get: x => x.p.en || "—", numeric: false },
      { label: "Centro Zonal", get: x => (x.p.cz || "—").replace(/^CZ\s*/, ""), numeric: false },
      { label: "Municipio", get: x => x.p.mun || "—", numeric: false },
      { label: "Dirección", get: x => x.p.dir || "—", numeric: false },
      { label: "Teléfono", get: x => x.p.tel || "—", numeric: false },
      { label: "Cupos", get: x => x.p.cu, fmt: x => mil(x.p.cu) },
      { label: "Atendidos", get: x => x.p.at, fmt: x => mil(x.p.at) },
      { label: "Disponibles", get: x => disponibles(x.p), fmt: x => chipCupos(x.p) },
      { label: "Distancia", get: x => x.d, fmt: x => fmtDist(x.d) },
    ];
    const grupos = bandas.map(b => ({ ...b, items: [] }));
    items.forEach(x => grupos.find(g => g.label === bandaDe(x.d, bandas).label).items.push(x));
    grupos.forEach(g => {
      if (!g.items.length) return;
      const det = el("details", "grupo-banda");
      det.style.setProperty("--acento", g.color);
      det.style.setProperty("--acento-suave", g.color + "22");
      const cuposG = g.items.reduce((s, x) => s + (x.p.cu || 0), 0);
      const sum = el("summary");
      sum.innerHTML =
        '<span class="gb-dot"></span>' +
        '<span class="gb-nombre">' + esc(g.label) + "</span>" +
        '<span class="gb-badges">' +
        '<span class="gb-n">' + g.items.length + (g.items.length === 1 ? " unidad" : " unidades") + "</span>" +
        '<span class="gb-cupos">' + mil(cuposG) + " cupos</span>" +
        "</span>";
      det.appendChild(sum);
      const cuerpo = el("div", "gb-cuerpo");
      cuerpo.appendChild(tabla(cols, g.items, { sortCol: 10, sortAsc: true, getId: x => x.p.id, onRowClick: x => abrirPopup(x.p.id) }));
      det.appendChild(cuerpo);
      resWrap.appendChild(det);
    });
  }

  if (MAPA) {
    items.forEach(({ p, d }) => {
      const color = colorCupos(p);
      const m = L.circleMarker([p.y, p.x], { radius: 6, color: "#fff", weight: 1.5, fillColor: color, fillOpacity: 0.9 }).addTo(MAPA);
      m.bindPopup("<b>" + esc(p.n || "(sin nombre)") + "</b>" +
        (p.dir ? "<br>" + esc(p.dir) : "") +
        "<br>" + esc(p.mun || "—") + (p.co ? " · " + esc(p.co) : "") + (p.b ? " · " + esc(p.b) : "") +
        "<br>Entidad: " + esc(p.en || "—") +
        "<br>Centro Zonal: " + esc((p.cz || "—").replace(/^CZ\s*/, "")) +
        (p.tel ? "<br>Tel: " + esc(p.tel) : "") +
        "<br>Cupos: " + mil(p.cu) + " · Atendidos: " + mil(p.at) + " · " + chipCupos(p) +
        "<br>" + fmtDist(d));
      m.off("click");
      m.on("click", (e) => {
        // los circleMarker burbujean su clic hacia el mapa por defecto
        // (bubblingMouseEvents), y el mapa tiene su propio "click" para
        // mover el pin y re-buscar (ver initMapaBase) -- sin cortar la
        // propagacion aqui, ese click en cascada reconstruye toda la tabla
        // de Resultados justo despues de resaltarFila() y deja el punto de
        // referencia saltando a la UDS en la que se hizo clic.
        L.DomEvent.stopPropagation(e);
        if (m.isPopupOpen()) m.closePopup(); else m.openPopup();
        resaltarFila(p.id);
      });
      if (p.id != null) MARCADOR_POR_ID[p.id] = m;
      RES_MARKERS.push(m);
    });
  }
}

/* ---------------- direccion (Nominatim) ---------------- */
function seleccionarCandidato(cand) {
  PUNTO = { lat: parseFloat(cand.lat), lon: parseFloat(cand.lon) };
  $("#candidatosDir").innerHTML = "";
  $("#estadoDir").textContent = "Dirección encontrada: " + cand.display_name;
  colocarPin(true);
  buscarYPintar();
}

async function geocodificar(query, viewbox) {
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=co&viewbox=" +
    viewbox + "&bounded=1&q=" + encodeURIComponent(query);
  const resp = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  return await resp.json();
}

// Nominatim no tiene numeracion predial en Colombia -- nunca resuelve un
// "#51-101" a un punto exacto, solo la via completa -- y ademas su parser
// devuelve 0 resultados si la consulta mezcla numero de puerta + barrio/
// vereda en el mismo texto, aunque cada dato por separado si funcione
// (verificado 2026-08-27: "Avenida 33 # 51-101, hermosa provincia" -> 0
// resultados; "Avenida 33 # 51-101" sola, o "hermosa provincia" sola, cada
// una encuentra algo). Por eso se prueba en cascada, de mas especifico a
// mas general, hasta que una version encuentre algo.
async function buscarConCascada(niveles, viewbox) {
  for (let i = 0; i < niveles.length; i++) {
    const texto = niveles[i];
    if (!texto) continue;
    const data = await geocodificar(texto, viewbox);
    if (data.length) return { data, nivel: i, textoUsado: texto };
  }
  return { data: [], nivel: -1, textoUsado: niveles[0] || "" };
}

function presentarResultadoBusqueda(data, nivel) {
  const estado = $("#estadoDir"), candidatos = $("#candidatosDir");
  if (!data.length) {
    estado.textContent = "No se encontró esa dirección dentro de " + MUNI.nombre + ", ni simplificándola. Ubica el punto manualmente en el mapa.";
    return;
  }
  // nivel 0 = la consulta tal cual se escribio/armo; nivel > 0 = tuvo que
  // simplificarse (se quito el numero exacto y/o el barrio) para encontrar
  // algo -- el punto ya no es la puerta exacta, solo avisa que hay que
  // ajustarlo a mano.
  const nota = nivel > 0
    ? " (no se encontró con todos los datos exactos; se ubicó una versión más general de la dirección — ajusta el pin arrastrándolo hasta el punto preciso)"
    : "";
  if (data.length === 1) {
    seleccionarCandidato(data[0]);
    if (nota) $("#estadoDir").textContent += nota;
  } else {
    estado.textContent = data.length + " coincidencias" + nota + " — elige la correcta:";
    candidatos.innerHTML = "";
    data.forEach(cand => {
      const b = el("button", "candidato", esc(cand.display_name));
      b.type = "button";
      b.onclick = () => seleccionarCandidato(cand);
      candidatos.appendChild(b);
    });
  }
}

// niveles de simplificacion del texto libre: el completo, luego solo lo
// que hay antes de la primera coma (por si el usuario ya separo numero y
// barrio con coma), y luego recortando hasta 3 palabras desde el final
// (cubre el caso sin coma, ej. "Avenida 33 #51-101 hermosa provincia").
function nivelesDesdeTexto(texto) {
  const niveles = [texto];
  const porComa = texto.split(",")[0].trim();
  if (porComa && porComa !== texto) niveles.push(porComa);
  const palabras = texto.trim().split(/\s+/);
  for (let quitar = 1; quitar <= Math.min(3, palabras.length - 2); quitar++) {
    niveles.push(palabras.slice(0, palabras.length - quitar).join(" "));
  }
  return [...new Set(niveles)];
}

async function buscarDireccion(texto) {
  const estado = $("#estadoDir"), candidatos = $("#candidatosDir");
  texto = (texto || "").trim();
  candidatos.innerHTML = "";
  if (!MUNI) { estado.textContent = "Selecciona primero un municipio arriba."; return; }
  if (!texto) { estado.textContent = "Escribe una dirección primero (ej: Calle 45 # 23-10)."; return; }
  estado.textContent = "Buscando “" + texto + "” en " + MUNI.nombre + "…";
  const bb = MUNI.bbox; // [oeste, sur, este, norte]
  const viewbox = [bb[0], bb[3], bb[2], bb[1]].join(",");
  const sufijo = ", " + MUNI.nombre + ", Antioquia, Colombia";
  const niveles = nivelesDesdeTexto(texto).map(n => n + sufijo);
  try {
    const { data, nivel } = await buscarConCascada(niveles, viewbox);
    presentarResultadoBusqueda(data, nivel);
  } catch (err) {
    estado.textContent = "No se pudo buscar la dirección (revisa la conexión a internet). También puedes ubicar el punto manualmente haciendo clic en el mapa.";
  }
}

// arma "Calle 45 # 23A - 10, complemento" a partir del formulario por
// partes -- misma nomenclatura urbana colombiana estandar, pensada para
// cuando el texto libre no geocodifica bien (abreviaturas, "Cra"/"Cll",
// falta de espacios) porque Nominatim no siempre las reconoce. Solo para
// mostrar en el campo de texto libre -- la busqueda real usa
// nivelesDesdePartes(), mas precisa porque conoce cada campo por separado.
function construirDireccionPartes() {
  const via = $("#viaTipo").value;
  const n1 = $("#viaNum1").value.trim();
  const n2 = $("#viaNum2").value.trim();
  const n3 = $("#viaNum3").value.trim();
  const compl = $("#viaComplemento").value.trim();
  if (!n1 || !n2) return null;
  let dir = via + " " + n1 + " # " + n2 + (n3 ? " - " + n3 : "");
  if (compl) dir += ", " + compl;
  return dir;
}

// version en cascada, campo por campo, del mismo formulario -- mas fina
// que nivelesDesdeTexto() porque sabe exactamente cual pedazo es el
// complemento (el que mas frecuentemente hace que Nominatim no encuentre
// nada si va junto con el numero, ver nota en buscarConCascada) y cual es
// la placa, en vez de adivinar recortando palabras del final.
function nivelesDesdePartes() {
  const via = $("#viaTipo").value;
  const n1 = $("#viaNum1").value.trim();
  const n2 = $("#viaNum2").value.trim();
  const n3 = $("#viaNum3").value.trim();
  const compl = $("#viaComplemento").value.trim();
  if (!n1 || !n2) return null;
  const sinPlaca = via + " " + n1 + " # " + n2;
  const conPlaca = n3 ? sinPlaca + " - " + n3 : sinPlaca;
  const niveles = [];
  if (compl) niveles.push(conPlaca + ", " + compl); // nivel 0: todo
  niveles.push(conPlaca);                            // nivel 1: sin complemento
  if (sinPlaca !== conPlaca) niveles.push(sinPlaca);  // nivel 2: sin placa
  if (compl) niveles.push(compl);                     // nivel 3: solo el complemento (barrio/vereda)
  return [...new Set(niveles)];
}

/* ---------------- municipio ---------------- */
// hibrido select+buscador: hace clic en el campo (sin escribir nada) y
// aparece la lista completa de los 125 municipios para recorrer con scroll
// -- igual que el <select> de antes -- y escribir la va filtrando en vivo
// (sin distinguir mayus/tildes). Coincidencias como botones "candidato",
// mismo patron que las coincidencias de direccion (ver
// presentarResultadoBusqueda) para que la interaccion se sienta igual en
// todo el sitio.
function normalizar(s) {
  return s.normalize("NFD").replace(new RegExp("[̀-ͯ]", "g"), "").toLowerCase();
}
function renderListaMunicipios(filtro) {
  const cont = $("#listaMunicipios");
  cont.innerHTML = "";
  const f = normalizar((filtro || "").trim());
  const coincidencias = f ? D.municipios.filter(m => normalizar(m.nombre).includes(f)) : D.municipios;
  coincidencias.forEach(m => {
    const b = el("button", "candidato", esc(m.nombre + " (" + m.n + " UDS)"));
    b.type = "button";
    b.onclick = () => seleccionarMunicipioInput(m.nombre);
    cont.appendChild(b);
  });
  if (f && !coincidencias.length) {
    cont.appendChild(el("div", "nota", "Sin coincidencias."));
  }
}
function seleccionarMunicipioInput(nombre) {
  $("#inputMunicipio").value = nombre;
  $("#listaMunicipios").innerHTML = "";
  onMunicipioChange(nombre);
}
function onMunicipioChange(nombre) {
  const inputDir = $("#inputDir"), btnBuscar = $("#btnBuscar"), btnPartes = $("#btnBuscarPartes");
  if (!nombre) {
    MUNI = null; PUNTO = null;
    inputDir.disabled = true; btnBuscar.disabled = true; btnPartes.disabled = true;
    inputDir.placeholder = "Selecciona primero un municipio arriba";
    $("#estadoDir").textContent = "";
    $("#candidatosDir").innerHTML = "";
    if (MARKER && MAPA) { MAPA.removeLayer(MARKER); MARKER = null; }
    dibujarPoligonoMunicipio();
    buscarYPintar();
    if (MAPA) {
      const bb = D.bbox_depto;
      MAPA.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]], { padding: [4, 4] });
    }
    return;
  }
  MUNI = D.municipios.find(m => m.nombre === nombre);
  inputDir.disabled = false; btnBuscar.disabled = false; btnPartes.disabled = false;
  inputDir.placeholder = "Dirección en " + MUNI.nombre + ": Calle 45 # 23-10...";
  inputDir.value = "";
  $("#estadoDir").textContent = "Pin ubicado por defecto en el centro de " + MUNI.nombre + " — arrástralo hasta el punto exacto, o busca una dirección arriba.";
  $("#candidatosDir").innerHTML = "";
  // contorno real del municipio (si el geojson lo trae -- todos menos
  // Medellin, que ahi queda subdividido en comunas, ver generar_datos_
  // cercania.py): se usa su propio getBounds() para el fitBounds, mas
  // ajustado que el bbox rectangular (que es solo la nube de puntos UDS
  // con margen, y en municipios grandes con UDS agrupadas en una zona
  // puede quedar muy lejos del borde real).
  const poligono = dibujarPoligonoMunicipio();
  if (MAPA) {
    if (poligono) {
      MAPA.fitBounds(poligono.getBounds(), { padding: [8, 8] });
    } else {
      const bb = MUNI.bbox;
      MAPA.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]], { padding: [4, 4] });
    }
  }
  PUNTO = { lat: MUNI.centro[0], lon: MUNI.centro[1] };
  colocarPin(false);
  buscarYPintar();
}

/* ---------------- init ---------------- */
function init() {
  const inputMuni = $("#inputMunicipio");
  inputMuni.oninput = () => {
    if (!inputMuni.value.trim() && MUNI) onMunicipioChange(null); // borraron el campo del todo -> se deselecciona
    renderListaMunicipios(inputMuni.value);
  };
  // al enfocar sin haber escrito nada se ve la lista completa (los 125
  // municipios, con scroll) -- se comporta como el <select> de antes ademas
  // de filtrar al escribir.
  inputMuni.onfocus = () => renderListaMunicipios(inputMuni.value);
  inputMuni.onkeydown = (e) => {
    if (e.key === "Enter") {
      const primero = $("#listaMunicipios .candidato");
      if (primero) primero.click();
    } else if (e.key === "Escape") {
      inputMuni.blur();
    }
  };
  // en click, mousedown dispara antes que blur -- el timeout deja que el
  // onclick del boton candidato (ver seleccionarMunicipioInput) alcance a
  // correr antes de que la lista se vacie.
  inputMuni.onblur = () => setTimeout(() => { $("#listaMunicipios").innerHTML = ""; }, 150);

  const inputDir = $("#inputDir"), btnBuscar = $("#btnBuscar");
  btnBuscar.onclick = () => buscarDireccion(inputDir.value);
  inputDir.onkeydown = (e) => { if (e.key === "Enter") buscarDireccion(inputDir.value); };

  $("#btnBuscarPartes").onclick = async () => {
    const estado = $("#estadoDir"), candidatos = $("#candidatosDir");
    const dir = construirDireccionPartes();
    if (!dir) { estado.textContent = "Completa al menos el Número y el Cruce (#) para armar la dirección."; return; }
    if (!MUNI) { estado.textContent = "Selecciona primero un municipio arriba."; return; }
    inputDir.value = dir; // asi el campo de texto libre muestra lo que se armo y quedo buscando
    candidatos.innerHTML = "";
    estado.textContent = "Buscando “" + dir + "” en " + MUNI.nombre + "…";
    const bb = MUNI.bbox;
    const viewbox = [bb[0], bb[3], bb[2], bb[1]].join(",");
    const sufijo = ", " + MUNI.nombre + ", Antioquia, Colombia";
    const niveles = nivelesDesdePartes().map(n => n + sufijo);
    try {
      const { data, nivel } = await buscarConCascada(niveles, viewbox);
      presentarResultadoBusqueda(data, nivel);
    } catch (err) {
      estado.textContent = "No se pudo buscar la dirección (revisa la conexión a internet). También puedes ubicar el punto manualmente haciendo clic en el mapa.";
    }
  };

  // el par lat/lon vive ahora como overlay flotante encima del mapa (ver
  // .latlon-mapa) y no tiene boton propio: cambiar cualquiera de los dos
  // campos (al salir del campo, o con Enter) mueve el pin ahi mismo. Los
  // valores YA vienen puestos por actualizarLatLon() en cada busqueda, asi
  // que en el uso normal nunca estan vacios -- las validaciones son por si
  // alguien escribe algo invalido a mano.
  const usarLatLon = () => {
    const estado = $("#estadoDir");
    const lat = parseFloat($("#inputLat").value.replace(",", "."));
    const lon = parseFloat($("#inputLon").value.replace(",", "."));
    if (isNaN(lat) || isNaN(lon)) { estado.textContent = "Escribe latitud y longitud en decimal (ej: 6.2447 y -75.5748)."; return; }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { estado.textContent = "Esas coordenadas no son válidas (latitud entre -90 y 90, longitud entre -180 y 180)."; return; }
    $("#candidatosDir").innerHTML = "";
    estado.textContent = "Punto ubicado por coordenadas.";
    PUNTO = { lat, lon };
    colocarPin(true);
    buscarYPintar();
  };
  $("#inputLat").onchange = $("#inputLon").onchange = usarLatLon;
  $("#inputLat").onkeydown = $("#inputLon").onkeydown = (e) => { if (e.key === "Enter") { usarLatLon(); e.target.blur(); } };

  initMapaBase();
  pintarLeyendaCupos();

  $("#fuentesDl").innerHTML =
    "<dt>Unidades de Servicio (UDS)</dt><dd>" + esc(D.meta.fuente) + " — " + mil(D.meta.n_uds) + " UDS activas con coordenada, en " + D.meta.n_municipios + " municipios.</dd>" +
    "<dt>Coordenadas</dt><dd>Se toman de las columnas \"Latitud UDS\"/\"Longitud UDS\" (grados/minutos/segundos) de la hoja CUENTAME, parseadas a decimal. " + (D.meta.n_sin_coordenada ? mil(D.meta.n_sin_coordenada) + " UDS activas no tenían coordenada legible y no aparecen aquí." : "Todas las UDS activas tenían coordenada legible.") + "</dd>" +
    "<dt>Contorno de cada municipio</dt><dd>Se dibuja el polígono real (\"antioquia_con_comunas v5.geojson\") de " + D.meta.n_con_poligono + " de los " + D.meta.n_municipios + " municipios al elegirlos arriba, simplificado para que cargue liviano. Medellín es la única excepción: en esa fuente queda subdividida en sus comunas en vez de un solo polígono, así que ahí se sigue usando el rectángulo que envuelve sus propias UDS.</dd>" +
    "<dt>Pin por defecto</dt><dd>Al abrir la página el pin ya está puesto en Medellín (capital del departamento) y el mapa se ve con el zoom suficiente para mostrar Antioquia completo, con el contorno tenue de los 124 municipios con polígono disponible, para poder ubicar el punto arrastrando el pin o haciendo clic sin necesidad de elegir un municipio antes. Al elegir un municipio, el pin salta al casco urbano (cabecera municipal, tomado de \"COORDENADAS MUNICIPIOS.xlsx\") — no al centro geométrico del contorno, que en municipios alargados o con corregimientos dispersos puede caer en zona rural despoblada — y ese contorno se resalta con trazo más marcado sobre el de los demás.</dd>" +
    "<dt>Coordenadas (latitud/longitud)</dt><dd>Los campos de latitud/longitud, debajo del formulario por partes, siempre reflejan el punto marcado (sin importar cómo se haya puesto: municipio, dirección, clic, arrastre o los campos mismos) y también permiten ubicar el punto directamente si ya se tienen las coordenadas, sin depender del geocodificador ni de internet.</dd>" +
    "<dt>Búsqueda de dirección</dt><dd>Usa el geocodificador gratuito de OpenStreetMap (Nominatim), acotado al municipio elegido; es un servicio externo en vivo y necesita conexión a internet. Nominatim no tiene numeración predial en Colombia (ubica la vía completa, no el número exacto de la puerta) y su buscador puede no encontrar nada si el número y el barrio/vereda van juntos en el mismo texto; por eso, si la búsqueda completa no encuentra nada, se reintenta automáticamente con versiones más simples (sin el complemento, sin la placa) — cuando eso pasa se avisa en el mensaje, y toca ajustar el pin arrastrándolo hasta el punto exacto. Ubicar el punto manualmente en el mapa no depende de internet salvo por la carga de los mapas base.</dd>" +
    "<dt>Radio de búsqueda</dt><dd>Adaptativo: empieza en 500 m y va ampliando (1, 2, 5, 10, 20, 50, 100 km) hasta encontrar al menos " + MIN_RESULTADOS + " UDS o llegar al tope — así una zona rural dispersa no se queda sin resultados. Los resultados se agrupan en 3 bandas (cerca / media / lejos), calculadas como tercios del radio que terminó usando cada búsqueda.</dd>" +
    "<dt>Color de cada UDS (mapa, tabla y pines)</dt><dd>Refleja disponibilidad de cupos, no distancia: <b style=\"display:inline;font-weight:700;color:#5FA829\">verde</b> = tiene cupos disponibles (cupos contratados por encima de los atendidos), <b style=\"display:inline;font-weight:700;color:#D64545\">rojo</b> = sin cupos disponibles (llena o sobre-ejecutada). La cercanía (bandas/anillos) solo agrupa los resultados, no cambia su color.</dd>" +
    "<dt>Este sitio, en relación con el tablero de Medellín</dt><dd>Reutiliza la misma lógica de geocodificación, distancia (Haversine) y mapa del módulo \"Cercanía\" del tablero de Buen Comienzo Medellín, extendida a las " + mil(D.meta.n_uds) + " UDS de ICBF-Cuéntame en todo el departamento. No incluye las Sedes de Buen Comienzo (exclusivas de Medellín).</dd>";

  $("#pieBuild").innerHTML =
    esc("Generado " + (D.build || "") + " · fuente: BD ANALISIS COBERTURA v21.xlsm") +
    '<br><span class="autoria">Desarrollado por Juan Pablo Velásquez Gómez</span>';
}

init();
</script>
</body>
</html>
