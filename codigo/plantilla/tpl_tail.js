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

/* ---------------- descarga de la hoja CUENTAME ----------------
   Genera un .xlsx de verdad (no un CSV renombrado) sin ninguna libreria
   externa: un xlsx es un ZIP con unos pocos XML dentro, y aqui se arma a
   mano. Se evita a proposito depender de un CDN mas -- el sitio ya carga
   Leaflet de unpkg y sumar otra dependencia de red significa un motivo mas
   por el que la descarga podria no funcionar en un equipo con el
   antivirus/proxy de la entidad de por medio.

   Se escribe con metodo "stored" (sin comprimir): evita tener que
   implementar DEFLATE, y a cambio el archivo pesa mas -- irrelevante para
   las decenas o cientos de filas que exporta una consulta. */

// CRC-32, requerido por el formato ZIP para cada entrada.
const CRC_TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLA[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ZIP minimo, entradas sin comprimir. Devuelve un Blob listo para descargar.
function armarZip(archivos) {
  const cod = new TextEncoder();
  const locales = [], central = [];
  let offset = 0;
  archivos.forEach(({ nombre, texto }) => {
    const datos = cod.encode(texto);
    const nom = cod.encode(nombre);
    const crc = crc32(datos);
    const cab = new DataView(new ArrayBuffer(30));
    cab.setUint32(0, 0x04034b50, true);   // firma local
    cab.setUint16(4, 20, true);           // version necesaria
    cab.setUint16(8, 0, true);            // metodo 0 = stored
    cab.setUint32(14, crc, true);
    cab.setUint32(18, datos.length, true);
    cab.setUint32(22, datos.length, true);
    cab.setUint16(26, nom.length, true);
    locales.push(new Uint8Array(cab.buffer), nom, datos);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);   // firma central
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(10, 0, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, datos.length, true);
    cen.setUint32(24, datos.length, true);
    cen.setUint16(28, nom.length, true);
    cen.setUint32(42, offset, true);      // donde empieza su cabecera local
    central.push(new Uint8Array(cen.buffer), nom);
    offset += 30 + nom.length + datos.length;
  });
  const tamCentral = central.reduce((s, a) => s + a.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);     // fin del directorio central
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, offset, true);
  return new Blob([...locales, ...central, new Uint8Array(fin.buffer)],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function escXml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]
  // los caracteres de control no son validos en XML 1.0 y Excel rechaza el
  // archivo entero si aparece uno; se limpian en vez de arriesgar eso.
  )).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}
// A, B, ... Z, AA, AB... para la referencia de cada celda.
function letraCol(n) {
  let s = "";
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}
/* ---- estilos ----
   Sin styles.xml el archivo sale plano: todo en la misma letra, encabezado
   indistinguible de los datos. Este es el minimo que Excel acepta sin
   quejarse; el orden de fonts/fills/borders/cellXfs es parte del formato, y
   los dos primeros rellenos (none y gray125) son obligatorios aunque no se
   usen -- si faltan, Excel da por corrupto el archivo entero.
   Los indices de cellXfs son los que despues se citan como s="1" / s="2". */
const ESTILO_ENCABEZADO = 1, ESTILO_CELDA = 2;
const ESTILOS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2">' +
  '<font><sz val="10"/><color theme="1"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
  "</fonts>" +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  // verde institucional ICBF, el mismo --icbf-verde-osc del sitio
  '<fill><patternFill patternType="solid"><fgColor rgb="FF2F6B10"/><bgColor indexed="64"/></patternFill></fill>' +
  "</fills>" +
  '<borders count="2">' +
  "<border><left/><right/><top/><bottom/><diagonal/></border>" +
  '<border><left style="thin"><color rgb="FFDDE6D2"/></left>' +
  '<right style="thin"><color rgb="FFDDE6D2"/></right>' +
  '<top style="thin"><color rgb="FFDDE6D2"/></top>' +
  '<bottom style="thin"><color rgb="FFDDE6D2"/></bottom><diagonal/></border>' +
  "</borders>" +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  // 1 = encabezado: negrilla, blanco sobre verde, centrado y con el texto
  //     ajustado (wrapText) para que un titulo largo se parta en dos lineas
  //     en vez de desbordarse sobre la columna vecina.
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
  '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
  // 2 = celda de datos: solo borde tenue y alineacion arriba. A proposito SIN
  //     wrapText: hay direcciones de 190 caracteres y ajustarlas convertiria
  //     cada fila en un bloque de seis renglones.
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' +
  '<alignment vertical="top"/></xf>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

// ancho de cada columna, del contenido real: se mira el encabezado y una
// muestra de las filas. Excel mide en "caracteres", no en pixeles.
function anchosDe(filas) {
  const muestra = filas.slice(1, 60);
  return filas[0].map((cab, j) => {
    let max = String(cab == null ? "" : cab).length;
    // el encabezado va en 2 lineas (wrapText), asi que no necesita el ancho
    // completo de su titulo: se cuenta como la mitad, con un piso razonable.
    max = Math.max(Math.ceil(max / 2) + 2, 9);
    muestra.forEach(f => {
      const n = String(f[j] == null ? "" : f[j]).length;
      if (n > max) max = n;
    });
    return Math.min(max + 2, 42); // tope: una direccion larga no debe robarse la pantalla
  });
}

// filas = [[valor, ...], ...]; la primera es el encabezado.
function hojaXml(filas) {
  const nCols = filas[0].length;
  const cuerpo = filas.map((fila, i) => {
    const estilo = i === 0 ? ESTILO_ENCABEZADO : ESTILO_CELDA;
    const celdas = fila.map((v, j) => {
      const ref = letraCol(j) + (i + 1);
      if (typeof v === "number" && isFinite(v)) {
        return '<c r="' + ref + '" s="' + estilo + '"><v>' + v + "</v></c>";
      }
      const t = escXml(v);
      // la celda vacia se escribe igual (antes se omitia) para que el borde
      // y el relleno no se corten a mitad de la tabla.
      if (t === "") return '<c r="' + ref + '" s="' + estilo + '"/>';
      // inlineStr evita tener que mantener un sharedStrings.xml aparte.
      return '<c r="' + ref + '" s="' + estilo + '" t="inlineStr"><is><t xml:space="preserve">' +
        t + "</t></is></c>";
    }).join("");
    // el encabezado lleva alto fijo: con el texto ajustado a dos lineas,
    // Excel no siempre recalcula el alto de la primera fila al abrir.
    const attrs = i === 0 ? ' ht="32" customHeight="1"' : "";
    return '<row r="' + (i + 1) + '"' + attrs + ">" + celdas + "</row>";
  }).join("");
  const cols = anchosDe(filas).map((w, j) =>
    '<col min="' + (j + 1) + '" max="' + (j + 1) + '" width="' + w + '" customWidth="1"/>').join("");
  const ultima = letraCol(nCols - 1) + filas.length;
  // el orden de los elementos lo fija el formato: sheetViews, cols,
  // sheetData y por ultimo autoFilter. Cambiarlo invalida el archivo.
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    // fila de encabezado congelada: al bajar por cientos de UDS se sigue
    // viendo que columna es cada cual.
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    "</sheetView></sheetViews>" +
    '<sheetFormatPr defaultRowHeight="14.5"/>' +
    "<cols>" + cols + "</cols>" +
    "<sheetData>" + cuerpo + "</sheetData>" +
    // filtros automaticos sobre el encabezado, para poder acotar por
    // entidad, servicio o vereda sin tener que armarlos a mano.
    '<autoFilter ref="A1:' + ultima + '"/>' +
    "</worksheet>";
}

// las 6 partes de un xlsx minimo, en una sola funcion para que el sitio y
// codigo/verificar_xlsx.mjs armen exactamente el mismo archivo (si el arnes
// de prueba mantuviera su propia copia de esta lista, podria pasar una
// prueba sobre algo distinto de lo que descarga el usuario).
function partesXlsx(filas, nombreHoja) {
  nombreHoja = (nombreHoja || "CUENTAME").replace(/[\\\/\?\*\[\]:]/g, " ").slice(0, 31);
  return [
    {
      nombre: "[Content_Types].xml",
      texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>",
    },
    {
      nombre: "_rels/.rels",
      texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    },
    {
      nombre: "xl/workbook.xml",
      texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="' + escXml(nombreHoja) + '" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      nombre: "xl/_rels/workbook.xml.rels",
      texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>",
    },
    { nombre: "xl/styles.xml", texto: ESTILOS_XML },
    { nombre: "xl/worksheets/sheet1.xml", texto: hojaXml(filas) },
  ];
}

function descargarXlsx(filas, nombreArchivo, nombreHoja) {
  const zip = armarZip(partesXlsx(filas, nombreHoja));
  const url = URL.createObjectURL(zip);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// X.filas[codigo] guarda cada valor como numero (tal cual) o como indice
// negativo a X.textos (-1 -> textos[0]), ver generar_datos_cuentame.py.
function filaCuentame(id) {
  const cruda = X.filas[id];
  if (!cruda) return null;
  return cruda.map(v => (typeof v === "number" && v < 0) ? X.textos[-v - 1] : v);
}
// Dos columnas propias al final, despues de las 56 de CUENTAME: la zona que
// ESTE sitio le atribuyo a cada UDS cruzando su coordenada contra el mapa
// veredal. Van rotuladas aparte a proposito -- no salen del reporte
// Cuentame, y CUENTAME ya trae un "Centro Poblado UDS" que es otra cosa y no
// siempre coincide. Ver la nota de precision del README.
const COLS_PROPIAS = [
  "Corregimiento (mapa veredal Antioquia)",
  "Vereda (mapa veredal Antioquia)",
];
// puntos = lista de UDS (objetos de D.puntos) tal como se ven en una tabla.
// Devuelve las filas y columnas del reporte CUENTAME original, mas las dos
// columnas de zona de este sitio.
function filasCuentameDe(puntos) {
  const filas = [X.cols.concat(COLS_PROPIAS)];
  puntos.forEach(p => {
    const f = filaCuentame(p.id);
    if (f) filas.push(f.concat([nombreCorrDeUds(p.id) || "", nombreVeredaDeUds(p.id) || ""]));
  });
  return filas;
}
function nombreArchivoExport(etiqueta) {
  const hoy = new Date();
  const dd = String(hoy.getDate()).padStart(2, "0");
  const mm = String(hoy.getMonth() + 1).padStart(2, "0");
  const limpia = String(etiqueta || "consulta")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ").trim().replace(/\s+/g, " ").slice(0, 60);
  return "CUENTAME - " + limpia + " - " + dd + mm + hoy.getFullYear() + ".xlsx";
}
// boton reutilizable: se le pasa como obtener las UDS en el momento del clic
// (no la lista ya resuelta) para que exporte siempre lo que la tabla muestra
// ahora, no lo que mostraba cuando se pinto el boton.
function botonDescargaExcel(obtenerPuntos, etiqueta, clase) {
  const b = el("button", clase || "btn-excel",
    '<span aria-hidden="true">⤓</span> Descargar Excel');
  b.type = "button";
  b.onclick = () => {
    const puntos = obtenerPuntos() || [];
    if (!puntos.length) return;
    const filas = filasCuentameDe(puntos);
    if (filas.length < 2) {
      b.textContent = "Sin datos para exportar";
      setTimeout(() => { b.innerHTML = '<span aria-hidden="true">⤓</span> Descargar Excel'; }, 2500);
      return;
    }
    descargarXlsx(filas, nombreArchivoExport(etiqueta()), "CUENTAME");
  };
  return b;
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

const INFO_UDS_VACIO = '<p class="info-uds-vacio">Pasa el cursor por el mapa para ver aquí la vereda sobre la que estás y su cobertura en cupos; ponlo sobre un punto para ver esa UDS en detalle — nombre, código, entidad, contrato, dirección, teléfono, servicio y cupos.</p>';
// contenido del panel #infoUds (ver mas abajo, junto al mapa) al pasar el
// mouse sobre una UDS -- reemplaza al tooltip flotante de Leaflet: al
// tener ancho y posicion fijos (siempre el mismo panel, mismo ancho del
// mapa) no se recorta ni se reacomoda segun donde caiga el punto o el
// zoom, como si le pasaba a un tooltip pegado al marcador cerca de un
// borde del mapa.
function contenidoInfoUds(p) {
  return '<div class="info-uds-nombre"><span>UDS</span>' + esc(p.n || "(sin nombre)") + "</div>" +
    '<div class="info-uds-grid">' +
    "<div><span>Código</span>" + esc(p.id || "—") + "</div>" +
    (p.contrato ? "<div><span>Contrato</span>" + esc(p.contrato) + "</div>" : "") +
    (p.serv ? '<div class="full"><span>Servicio</span>' + esc(p.serv) + "</div>" : "") +
    '<div class="full"><span>Entidad</span>' + esc(p.en || "—") + "</div>" +
    (p.dir ? '<div class="full"><span>Dirección</span>' + esc(p.dir) + "</div>" : "") +
    (p.tel ? "<div><span>Tel</span>" + esc(p.tel) + "</div>" : "") +
    "<div><span>Cupos</span>" + mil(disponibles(p)) + " disponibles</div>" +
    "</div>";
}
// #infoUds es de altura FIJA (no crece con el contenido, ver CSS -- eso
// es justo lo que evita el parpadeo del hover) pero el contenido varia
// mucho: hay entidades contratistas y direcciones reales en la base
// fuente de mas de 100-190 caracteres, imposibles de acotar de antemano
// solo con CSS estatico sin terminar en scroll o texto cortado. Aqui se
// pinta el contenido y, si no entra completo en la altura fija, se
// achica la letra en hasta 2 escalones (clases .compacto/.muy-compacto,
// ver CSS) hasta que quepa sin scroll.
function mostrarInfoUds(p) {
  const panel = $("#infoUds");
  panel.classList.remove("compacto", "muy-compacto", "super-compacto", "zona");
  panel.innerHTML = contenidoInfoUds(p);
  ajustarInfo(panel);
}
// achica la letra en escalones hasta que el contenido quepa en la altura fija
function ajustarInfo(panel) {
  if (panel.scrollHeight > panel.clientHeight) {
    panel.classList.add("compacto");
    if (panel.scrollHeight > panel.clientHeight) {
      panel.classList.add("muy-compacto");
      if (panel.scrollHeight > panel.clientHeight) panel.classList.add("super-compacto");
    }
  }
}
function limpiarInfo() {
  const panel = $("#infoUds");
  if (!panel) return;
  panel.classList.remove("compacto", "muy-compacto", "super-compacto", "zona");
  panel.innerHTML = INFO_UDS_VACIO;
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
      if (opt.claseFila) { const c = opt.claseFila(f); if (c) tr.classList.add(c); }
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

/* ---------------- territorio: veredas y corregimientos ---------------- */
// Los 5084 contornos veredales vienen codificados como "encoded polyline"
// (deltas entre puntos consecutivos, en texto; ver encode_polyline en
// generar_datos_veredas.py). Dos razones, y la segunda es la importante:
//   1. pesan ~4x menos que arreglos de numeros (1,5 MB en vez de 6 MB), y
//   2. mientras son texto NO son objetos de JavaScript -- decodificar los
//      400 mil vertices de una seria medio segundo largo de bloqueo al abrir
//      la pagina, para dibujar como mucho las 235 veredas de un municipio.
// Por eso se decodifican por demanda, municipio por municipio, y se memoiza:
// cada vereda se decodifica una sola vez en toda la sesion.
function decodePolyline(str) {
  const pts = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    let sh = 0, res = 0, b;
    do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
    lat += (res & 1) ? ~(res >> 1) : (res >> 1);
    sh = 0; res = 0;
    do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
    lon += (res & 1) ? ~(res >> 1) : (res >> 1);
    // 1e-4 = 4 decimales: TIENE que coincidir con PRECISION en
    // generar_datos_veredas.py, o los contornos salen desplazados 10x.
    pts.push([lat * 1e-4, lon * 1e-4]);
  }
  return pts;
}

// clave "v123"/"c45" -> [[anilloExt, hueco...], [anilloExt2...]] en [lat,lon].
// Esa forma anidada es justo la que Leaflet entiende como multi-poligono con
// huecos en L.polygon(), sin tener que reacomodar nada.
const CACHE_GEOM = new Map();
function anillosDe(clave, codificado) {
  let g = CACHE_GEOM.get(clave);
  if (!g) {
    g = (codificado || []).map(poly => poly.map(decodePolyline));
    CACHE_GEOM.set(clave, g);
  }
  return g;
}
function anillosVereda(i) { return anillosDe("v" + i, V.veredas[i].g); }
function anillosCorr(i) { return anillosDe("c" + i, V.corregimientos[i].g); }

// ray-casting par/impar clasico sobre un anillo. Base comun de las dos
// pruebas de pertenencia del sitio: puntoEnGeom() aqui abajo (veredas y
// corregimientos, forma anidada con huecos explicitos) y puntoEnPoligono()
// mas abajo (municipios, lista plana de anillos).
function puntoEnAnillo(lat, lon, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const yi = anillo[i][0], xi = anillo[i][1];
    const yj = anillo[j][0], xj = anillo[j][1];
    const cruza = (yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}
// punto dentro de un multi-poligono con huecos: dentro del anillo exterior de
// alguno de sus poligonos y fuera de los huecos de ESE poligono.
function puntoEnGeom(lat, lon, polys) {
  for (const poly of polys) {
    if (!poly.length || !puntoEnAnillo(lat, lon, poly[0])) continue;
    let enHueco = false;
    for (let k = 1; k < poly.length; k++) {
      if (puntoEnAnillo(lat, lon, poly[k])) { enHueco = true; break; }
    }
    if (!enHueco) return true;
  }
  return false;
}

// indices por municipio (V.veredas[i].m es la posicion del municipio en
// D.municipios, la misma que usa todo lo demas del sitio)
const VEREDAS_POR_MUNI = {}, CORR_POR_MUNI = {};
V.veredas.forEach((v, i) => { (VEREDAS_POR_MUNI[v.m] = VEREDAS_POR_MUNI[v.m] || []).push(i); });
V.corregimientos.forEach((c, i) => { (CORR_POR_MUNI[c.m] = CORR_POR_MUNI[c.m] || []).push(i); });
// indice inverso zona -> UDS, para poder listar TODAS las UDS de una vereda o
// corregimiento sin importar a que distancia quedaron del pin (una vereda
// grande puede tener UDS mas alla del radio que uso la busqueda por cercania,
// y para "que UDS hay en esta vereda" esas cuentan igual). Se arma una sola
// vez sobre los 4328 puntos, no en cada busqueda.
const UDS_POR_VEREDA = {}, UDS_POR_CORR = {};
D.puntos.forEach(p => {
  const a = V.uds[p.id];
  if (!a) return;
  (UDS_POR_VEREDA[a[0]] = UDS_POR_VEREDA[a[0]] || []).push(p);
  if (a.length > 1) (UDS_POR_CORR[a[1]] = UDS_POR_CORR[a[1]] || []).push(p);
});
function udsDeZona(t) {
  if (!t) return [];
  return (t.tipo === "corr" ? UDS_POR_CORR[t.idx] : UDS_POR_VEREDA[t.idx]) || [];
}
// esta UDS cae dentro de la zona que se esta mirando? (para marcar su fila en
// las tablas por banda de distancia, sin tener que cruzarlas a ojo)
function enZonaActual(id) {
  if (!TERRITORIO) return false;
  const a = V.uds[id];
  if (!a) return false;
  return TERRITORIO.tipo === "corr" ? (a.length > 1 && a[1] === TERRITORIO.idx) : a[0] === TERRITORIO.idx;
}
// UDS -> [indice vereda, indice corregimiento?]  (clave: Codigo UDS)
function territorioDeUds(id) { return V.uds[id] || null; }
function nombreVeredaDeUds(id) {
  const a = territorioDeUds(id);
  return a ? V.veredas[a[0]].n : null;
}
function nombreCorrDeUds(id) {
  const a = territorioDeUds(id);
  return a && a.length > 1 ? V.corregimientos[a[1]].n : null;
}

// Familia amarilla institucional para TODO lo territorial (los dos filtros,
// los contornos y el bloque de resultados por zona). Deliberadamente distinta
// del verde del municipio que la engloba -- y tambien del verde/azul/violeta
// de los anillos de distancia, que responden otra pregunta y no deben
// confundirse con una division politica.
const COLOR_ZONA = "#C99A00", RELLENO_ZONA = "#FFDC2F";
// jerarquia de tres niveles anidados, del mas general al mas especifico:
//   municipio     verde, trazo 2.5, relleno .08   (ya existia, no se toca)
//   corregimiento amarillo, trazo 3 DISCONTINUO, relleno .13
//   vereda        amarillo, trazo 3 CONTINUO,    relleno .22
// Corregimiento y vereda comparten color a proposito (son la misma familia,
// una contiene a la otra); lo que las separa es el trazo y la intensidad del
// relleno, que es la "sutil diferencia" pedida sin meter un cuarto color.
const ESTILO_CORR = { color: COLOR_ZONA, weight: 3, dashArray: "8 5", fillColor: RELLENO_ZONA, fillOpacity: 0.13 };
const ESTILO_VEREDA = { color: COLOR_ZONA, weight: 3, fillColor: RELLENO_ZONA, fillOpacity: 0.22 };
// las demas veredas del municipio: solo insinuadas, sin relleno, para que se
// vean "las veredas que lo rodean" sin competir con la zona elegida ni tapar
// las UDS.
// CONTINUO, no punteado. El tipo de trazo codifica QUE division es, y tiene
// que significar lo mismo en todo el mapa:
//     discontinuo = corregimiento     continuo = vereda
// El grosor y la opacidad codifican otra cosa: si la zona esta elegida o si
// es solo contexto. Antes esta capa iba punteada, asi que las veredas del
// municipio se leian como corregimientos -- la unica entrada discontinua de
// la leyenda -- y contradecia su propia entrada "Vereda", que muestra trazo
// continuo.
const ESTILO_VEREDAS_CTX = { color: COLOR_ZONA, weight: 1.2, opacity: 0.7, fill: false, interactive: false };
// El amarillo institucional sobre los tiles de OpenStreetMap (verdes y ocres
// en zona rural, que es donde estan casi todas las veredas) se pierde: medido
// en pantalla, el trazo se dibujaba pero era practicamente invisible. La
// solucion estandar en cartografia es el "realce": una linea blanca un poco
// mas gruesa por debajo, que despega el trazo de cualquier fondo sin cambiar
// su color ni ensuciar el mapa. Se aplica a las tres capas territoriales.
const ESTILO_REALCE_CTX = { color: "#FFFFFF", weight: 3.2, opacity: 0.55, fill: false, interactive: false };
const ESTILO_REALCE_ZONA = { color: "#FFFFFF", weight: 6, opacity: 0.65, fill: false, interactive: false };

/* ---------------- estado del territorio ---------------- */
// TERRITORIO refleja SIEMPRE donde esta el pin, igual que el campo de
// municipio: se puede fijar eligiendo en el desplegable (y entonces el pin
// salta al centro de esa zona) o se actualiza solo cuando el pin se mueve por
// cualquier otra via. "tipo" recuerda a que nivel se esta mirando para no
// degradar un corregimiento elegido a la vereda suelta donde cayo el pin.
let TERRITORIO = null;      // {tipo:"corr"|"vereda", idx}
// Filtros encadenados, como en un Excel: municipio acota corregimiento y
// vereda, y el corregimiento acota a su vez la lista de veredas. Por defecto
// la lista de veredas se restringe al corregimiento que este activo; ese
// encadenamiento se suelta con la opcion "Todos los corregimientos" del
// desplegable, y vuelve a aplicarse en cuanto se elige un corregimiento
// concreto o se cambia de municipio.
let VER_TODAS_VEREDAS = false;

// corregimiento actualmente activo (sea porque se eligio directamente o
// porque es el de la vereda donde esta el pin); null si no hay ninguno.
function corrActual() {
  if (!TERRITORIO) return null;
  if (TERRITORIO.tipo === "corr") return TERRITORIO.idx;
  const v = V.veredas[TERRITORIO.idx];
  return v.cr != null ? v.cr : null;
}
let CAPA_ZONA = null;       // poligono resaltado de la zona actual
let CAPA_VEREDAS_CTX = null;// contorno tenue de las demas veredas del municipio
let VER_VEREDAS_CTX = true;
let LIENZO = null;          // renderer canvas (ver initMapaBase)

function idxMuniActual() {
  if (!MUNI) return -1;
  return D.municipios.indexOf(MUNI);
}

/* ---------------- hover: que vereda hay bajo el cursor ----------------
   El contorno de contexto se dibuja como UN solo poligono con todos los
   anillos del municipio (ver dibujarVeredasContexto): eso es lo que permite
   que Turbo, con 235 veredas, no arrastre el mapa. La contrapartida es que
   esa capa no puede decir por si sola sobre cual vereda esta el cursor.
   En vez de volver a partirla en 235 capas interactivas, se resuelve por
   calculo: en cada mousemove se busca la vereda que contiene el punto,
   reusando el mismo puntoEnGeom() del resto del sitio. Con el bbox como
   descarte previo, lo normal es evaluar uno o dos poligonos de verdad. */
const BBOX_ZONA = new Map();
function bboxVereda(i) {
  let b = BBOX_ZONA.get(i);
  if (!b) {
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    anillosVereda(i).forEach(poly => poly.forEach(anillo => anillo.forEach(pt => {
      if (pt[0] < minLat) minLat = pt[0];
      if (pt[0] > maxLat) maxLat = pt[0];
      if (pt[1] < minLon) minLon = pt[1];
      if (pt[1] > maxLon) maxLon = pt[1];
    })));
    b = [minLat, minLon, maxLat, maxLon];
    BBOX_ZONA.set(i, b);
  }
  return b;
}
function veredaEnPunto(lat, lon) {
  const im = idxMuniActual();
  if (im < 0) return -1;
  for (const i of (VEREDAS_POR_MUNI[im] || [])) {
    const b = bboxVereda(i);
    if (lat < b[0] || lat > b[2] || lon < b[1] || lon > b[3]) continue;
    if (puntoEnGeom(lat, lon, anillosVereda(i))) return i;
  }
  return -1;
}

// mientras el cursor esta sobre el punto de una UDS manda esa informacion,
// mas especifica que la de la zona que la contiene.
let HOVER_UDS = false;
let ZONA_HOVER = -1;   // vereda que se esta mostrando ahora (-1 = ninguna)

function contenidoInfoZona(i) {
  const v = V.veredas[i];
  const corr = v.cr != null ? V.corregimientos[v.cr] : null;
  const lista = UDS_POR_VEREDA[i] || [];
  const cupos = lista.reduce((s, p) => s + (p.cu || 0), 0);
  const aten = lista.reduce((s, p) => s + (p.at || 0), 0);
  const disp = cupos - aten;
  const tipo = (v.t && v.t !== "VE" ? (TIPO_TERRITORIO[v.t] || "Vereda") : "Vereda");
  return '<div class="info-uds-nombre"><span>' + esc(tipo) + "</span>" + esc(v.n) + "</div>" +
    '<div class="info-uds-grid">' +
    (corr ? "<div><span>Corregimiento</span>" + esc(corr.n) + "</div>" : "") +
    "<div><span>Municipio</span>" + esc(V.municipios[v.m]) + "</div>" +
    "<div><span>UDS</span>" + (lista.length ? mil(lista.length) : "ninguna") + "</div>" +
    (lista.length
      ? "<div><span>Cupos</span>" + mil(cupos) + "</div>" +
        "<div><span>Atendidos</span>" + mil(aten) + "</div>" +
        '<div><span>Disponibles</span><b style="color:' +
          (disp > 0 ? COLOR_CON_CUPOS : COLOR_SIN_CUPOS) + '">' + mil(disp) + "</b></div>"
      : '<div class="full">Sin unidades de servicio georreferenciadas en esta zona.</div>') +
    "</div>";
}
function mostrarInfoZona(i) {
  const panel = $("#infoUds");
  if (!panel) return;
  panel.classList.remove("compacto", "muy-compacto", "super-compacto");
  panel.classList.add("zona");
  panel.innerHTML = contenidoInfoZona(i);
  ajustarInfo(panel);
}
// se llama desde el mousemove del mapa (ver initMapaBase)
function actualizarHoverZona(lat, lon) {
  if (HOVER_UDS) return;                 // la UDS manda
  const i = veredaEnPunto(lat, lon);
  if (i === ZONA_HOVER) return;          // nada cambio: no se repinta
  ZONA_HOVER = i;
  if (i < 0) limpiarInfo();
  else mostrarInfoZona(i);
}

function dibujarVeredasContexto() {
  if (!MAPA) return;
  if (CAPA_VEREDAS_CTX) { MAPA.removeLayer(CAPA_VEREDAS_CTX); CAPA_VEREDAS_CTX = null; }
  const im = idxMuniActual();
  if (im < 0 || !VER_VEREDAS_CTX) return;
  const idxs = VEREDAS_POR_MUNI[im] || [];
  if (!idxs.length) return;
  const polys = [];
  idxs.forEach(i => { anillosVereda(i).forEach(p => polys.push(p)); });
  if (!polys.length) return;
  // renderer canvas: un municipio como Turbo son 235 poligonos; en SVG eso es
  // un nodo del DOM por vereda y el mapa se arrastra al hacer zoom/paneo.
  // Dos trazos superpuestos (realce blanco debajo, linea amarilla encima),
  // ver ESTILO_REALCE_CTX.
  const realce = L.polygon(polys, Object.assign({ renderer: LIENZO }, ESTILO_REALCE_CTX));
  const linea = L.polygon(polys, Object.assign({ renderer: LIENZO }, ESTILO_VEREDAS_CTX));
  CAPA_VEREDAS_CTX = L.featureGroup([realce, linea]).addTo(MAPA);
  CAPA_VEREDAS_CTX.bringToBack();
  // OJO: bringToBack() sobre un featureGroup se lo aplica a cada hijo EN ORDEN,
  // y en un renderer de canvas "atras" es "se dibuja primero" -- el resultado
  // es que el realce blanco terminaba pintandose ENCIMA del trazo amarillo y
  // lo borraba (se veian lineas casi blancas). Volver a traer al frente solo
  // el trazo restablece el orden correcto dentro del canvas; no afecta al
  // contorno municipal, que es SVG y vive en otro elemento.
  linea.bringToFront();
  if (POLIGONO_MUNI) POLIGONO_MUNI.bringToBack();
}

function dibujarZona(ajustarVista) {
  if (!MAPA) return;
  if (CAPA_ZONA) { MAPA.removeLayer(CAPA_ZONA); CAPA_ZONA = null; }
  if (!TERRITORIO) return;
  const esCorr = TERRITORIO.tipo === "corr";
  const polys = esCorr ? anillosCorr(TERRITORIO.idx) : anillosVereda(TERRITORIO.idx);
  if (!polys.length) return;
  // mismo realce blanco debajo que la capa de contexto (ver ESTILO_REALCE_ZONA)
  CAPA_ZONA = L.featureGroup([
    L.polygon(polys, ESTILO_REALCE_ZONA),
    L.polygon(polys, esCorr ? ESTILO_CORR : ESTILO_VEREDA),
  ]).addTo(MAPA);
  if (ajustarVista) MAPA.fitBounds(CAPA_ZONA.getBounds(), { padding: [10, 10], animate: false });
}

// nombre a mostrar en cada campo + refresco de los dos desplegables
function pintarCamposTerritorio() {
  const iCorr = $("#inputCorregimiento"), iVer = $("#inputVereda");
  if (!TERRITORIO) {
    iCorr.value = ""; iVer.value = "";
  } else if (TERRITORIO.tipo === "vereda") {
    const v = V.veredas[TERRITORIO.idx];
    iVer.value = v.n;
    iCorr.value = v.cr != null ? V.corregimientos[v.cr].n : "";
  } else {
    iCorr.value = V.corregimientos[TERRITORIO.idx].n;
    iVer.value = "";
  }
  actualizarPlaceholderVereda(); // el corregimiento activo cambia cuantas veredas se listan
}

// camino inverso: el pin se movio -> se averigua en que vereda cayo y los dos
// campos se ponen al dia solos. Exactamente el mismo trato que ya recibe el
// campo de municipio (ver sincronizarMunicipioConPunto).
function sincronizarTerritorioConPunto() {
  if (!PUNTO) return;
  const im = idxMuniActual();
  if (im < 0) { TERRITORIO = null; pintarCamposTerritorio(); return; }
  // si se venia mirando un corregimiento y el pin sigue dentro de el, se
  // respeta ese nivel -- si no, el corregimiento elegido se perderia apenas
  // se arrastra el pin unos metros dentro de su propia vereda.
  if (TERRITORIO && TERRITORIO.tipo === "corr" && V.corregimientos[TERRITORIO.idx].m === im &&
      puntoEnGeom(PUNTO.lat, PUNTO.lon, anillosCorr(TERRITORIO.idx))) {
    return;
  }
  let encontrada = null;
  for (const i of (VEREDAS_POR_MUNI[im] || [])) {
    if (puntoEnGeom(PUNTO.lat, PUNTO.lon, anillosVereda(i))) { encontrada = i; break; }
  }
  if (encontrada == null) {
    // el pin quedo dentro del municipio pero fuera de toda vereda (pasa justo
    // sobre un borde, por el redondeo de los contornos): se deja lo que habia
    // en vez de vaciar los campos por un par de metros.
    return;
  }
  const antes = TERRITORIO;
  TERRITORIO = { tipo: "vereda", idx: encontrada };
  if (!antes || antes.tipo !== "vereda" || antes.idx !== encontrada) {
    pintarCamposTerritorio();
    dibujarZona(false); // sin reencuadrar: el pin ya esta donde el usuario lo puso
  }
}

// elegir en el desplegable: el pin salta al interior de la zona y el mapa se
// ajusta a ella -- mismo comportamiento que elegir municipio.
function seleccionarZona(tipo, idx) {
  TERRITORIO = { tipo: tipo, idx: idx };
  const z = tipo === "corr" ? V.corregimientos[idx] : V.veredas[idx];
  // el municipio de la zona manda: elegir una vereda de otro municipio
  // arrastra tambien el filtro de municipio, no lo deja desincronizado.
  const nombreMuni = D.municipios[z.m] ? D.municipios[z.m].nombre : null;
  if (nombreMuni && (!MUNI || MUNI.nombre !== nombreMuni)) {
    MUNI = D.municipios[z.m];
    $("#inputMunicipio").value = nombreMuni;
    const inputDir = $("#inputDir");
    inputDir.disabled = false; $("#btnBuscar").disabled = false; $("#btnBuscarPartes").disabled = false;
    inputDir.placeholder = "Dirección en " + nombreMuni + ": Calle 45 # 23-10...";
    dibujarPoligonoMunicipio();
    dibujarVeredasContexto();
    limpiarListasTerritorio();
  }
  pintarCamposTerritorio();
  // z.p es un punto garantizado DENTRO del poligono (representative_point de
  // shapely), no el centroide: en una vereda con forma de herradura -- comunes
  // siguiendo un rio o una cuchilla -- el centroide cae afuera y el pin
  // terminaria en la vereda vecina.
  PUNTO = { lat: z.p[0], lon: z.p[1] };
  $("#estadoDir").textContent = "Pin ubicado dentro de " +
    (tipo === "corr" ? "el corregimiento " : "la vereda ") + z.n +
    " — arrástralo hasta el punto exacto si lo necesitas.";
  $("#candidatosDir").innerHTML = "";
  colocarPin(false, true);
  dibujarZona(true);
  buscarYPintar(true); // la vista ya quedo ajustada a la zona, no reencuadrar a los anillos
}

/* ---------------- desplegables de corregimiento y vereda ---------------- */
// las dos listas solo se pintan cuando el campo tiene el foco (igual que la
// de municipio). Al cambiar de municipio hay que VACIARLAS, no repintarlas:
// dejarlas pintadas las dejaba desplegadas sobre la tarjeta sin que nadie
// hubiera hecho clic.
// el campo de vereda anuncia cuantas opciones tiene DE VERDAD ahora mismo:
// con el encadenamiento activo son las del corregimiento, no las 112 del
// municipio. Se llama cada vez que cambia la zona o el encadenamiento.
function actualizarPlaceholderVereda() {
  const iVer = $("#inputVereda");
  if (iVer.disabled) return;
  const im = idxMuniActual();
  if (im < 0) return;
  const restr = VER_TODAS_VEREDAS ? null : corrActual();
  const n = (VEREDAS_POR_MUNI[im] || []).filter(i => restr == null || V.veredas[i].cr === restr).length;
  if (!n) { iVer.placeholder = "Sin veredas en la fuente"; return; }
  iVer.placeholder = restr == null
    ? n + " veredas del municipio — escribe o haz clic"
    : n + (n === 1 ? " vereda en " : " veredas en ") + V.corregimientos[restr].n;
}

function limpiarListasTerritorio() {
  $("#listaCorregimientos").innerHTML = "";
  $("#listaVeredas").innerHTML = "";
}

function habilitarFiltrosTerritorio(activo) {
  const iCorr = $("#inputCorregimiento"), iVer = $("#inputVereda");
  iCorr.disabled = iVer.disabled = !activo;
  const im = idxMuniActual();
  const nCorr = (CORR_POR_MUNI[im] || []).length, nVer = (VEREDAS_POR_MUNI[im] || []).length;
  iCorr.placeholder = activo
    ? (nCorr ? nCorr + " corregimientos — escribe o haz clic" : "Este municipio no tiene corregimientos")
    : "Elige primero un municipio";
  iVer.placeholder = activo
    ? (nVer ? nVer + " veredas — escribe o haz clic" : "Sin veredas en la fuente")
    : "Elige primero un municipio";
  actualizarPlaceholderVereda();
  if (!nCorr) iCorr.disabled = true;
  $("#btnVeredasMuni").classList.toggle("visible", activo && nVer > 0);
}

function renderListaCorregimientos(filtro) {
  const cont = $("#listaCorregimientos");
  cont.innerHTML = "";
  const im = idxMuniActual();
  if (im < 0) return;
  const f = normalizar((filtro || "").trim());
  const idxs = (CORR_POR_MUNI[im] || [])
    .filter(i => !f || normalizar(V.corregimientos[i].n).includes(f))
    .sort((a, b) => V.corregimientos[a].n.localeCompare(V.corregimientos[b].n, "es"));
  // soltar el encadenamiento sin salir del municipio: deja de acotar la lista
  // de veredas al corregimiento activo y devuelve el pin a la vista del
  // municipio completo.
  if (!f && corrActual() != null) {
    const todos = el("button", "candidato",
      "<b>Todos los corregimientos</b>" +
      '<span class="pista">Lista las veredas de todo el municipio</span>');
    todos.type = "button";
    todos.onclick = () => {
      $("#listaCorregimientos").innerHTML = "";
      VER_TODAS_VEREDAS = true;
      pintarCamposTerritorio();
      if (MAPA && POLIGONO_MUNI) MAPA.fitBounds(POLIGONO_MUNI.getBounds(), { padding: [8, 8], animate: false });
    };
    cont.appendChild(todos);
  }
  idxs.forEach(i => {
    const c = V.corregimientos[i];
    const b = el("button", "candidato", esc(c.n) +
      '<span class="pista">' + c.nv + (c.nv === 1 ? " vereda" : " veredas") +
      " · " + c.nu + (c.nu === 1 ? " UDS" : " UDS") + "</span>");
    b.type = "button";
    b.onclick = () => {
      $("#listaCorregimientos").innerHTML = "";
      VER_TODAS_VEREDAS = false; // elegir un corregimiento reactiva el encadenamiento
      seleccionarZona("corr", i);
    };
    cont.appendChild(b);
  });
  if (f && !idxs.length) cont.appendChild(el("div", "nota", "Sin coincidencias."));
}

// etiqueta legible de los codigos VERE_TIPO del mapa veredal -- sin esto, en
// el desplegable aparecen entradas que no son veredas (la cabecera municipal,
// centros poblados, resguardos, parques) sin ninguna pista de que son.
const TIPO_TERRITORIO = {
  VE: "Vereda", CM: "Cabecera municipal", CO: "Centro poblado", CA: "Caserío",
  IN: "Territorio indígena", RI: "Resguardo indígena", PN: "Parque nacional",
  EM: "Emplazamiento", CV: "Caserío/vereda", ZE: "Zona especial", SL: "Suelo",
  BN: "Bien nacional", RF: "Reserva forestal", CI: "Centro industrial", AE: "Aeropuerto",
};
function renderListaVeredas(filtro) {
  const cont = $("#listaVeredas");
  cont.innerHTML = "";
  const im = idxMuniActual();
  if (im < 0) return;
  const f = normalizar((filtro || "").trim());
  // encadenamiento con el filtro de corregimiento (ver VER_TODAS_VEREDAS)
  const restr = VER_TODAS_VEREDAS ? null : corrActual();
  const idxs = (VEREDAS_POR_MUNI[im] || [])
    .filter(i => restr == null || V.veredas[i].cr === restr)
    .filter(i => !f || normalizar(V.veredas[i].n).includes(f))
    .sort((a, b) => V.veredas[a].n.localeCompare(V.veredas[b].n, "es"));
  if (restr != null) {
    const aviso = el("button", "candidato",
      "<b>Ver las veredas de todo el municipio</b>" +
      '<span class="pista">Ahora solo se listan las de ' + esc(V.corregimientos[restr].n) + "</span>");
    aviso.type = "button";
    aviso.onclick = () => {
      VER_TODAS_VEREDAS = true;
      actualizarPlaceholderVereda();
      renderListaVeredas($("#inputVereda").value);
      $("#inputVereda").focus();
    };
    cont.appendChild(aviso);
  }
  idxs.forEach(i => {
    const v = V.veredas[i];
    const partes = [];
    if (v.t && v.t !== "VE") partes.push(TIPO_TERRITORIO[v.t] || v.t);
    if (v.cr != null) partes.push("Corr. " + V.corregimientos[v.cr].n);
    partes.push(v.nu + (v.nu === 1 ? " UDS" : " UDS"));
    const b = el("button", "candidato", esc(v.n) + '<span class="pista">' + esc(partes.join(" · ")) + "</span>");
    b.type = "button";
    b.onclick = () => { $("#listaVeredas").innerHTML = ""; seleccionarZona("vereda", i); };
    cont.appendChild(b);
  });
  if (f && !idxs.length) cont.appendChild(el("div", "nota", "Sin coincidencias."));
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
  // renderer canvas compartido por la capa de contexto veredal: dibujar las
  // 235 veredas de un municipio como Turbo en SVG son 235 nodos del DOM y el
  // mapa se arrastra visiblemente al hacer zoom o paneo. En canvas es un solo
  // elemento. padding 0.3 = sigue dibujando un poco mas alla del borde
  // visible, para que al arrastrar no aparezca el recorte.
  LIENZO = L.canvas({ padding: 0.3 });
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
  // hover de zona: nombre de la vereda bajo el cursor y su cobertura en
  // cupos, en el mismo panel fijo que ya usa el hover de una UDS. No se
  // limita a cuando hay filtro puesto -- basta con estar viendo un municipio,
  // que es cuando estan cargadas sus veredas.
  map.on("mousemove", (e) => actualizarHoverZona(e.latlng.lat, e.latlng.lng));
  // salir del recuadro del mapa no dispara mousemove: sin esto el panel se
  // queda con la ultima zona pintada.
  map.on("mouseout", () => { ZONA_HOVER = -1; if (!HOVER_UDS) limpiarInfo(); });
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
  buscarYPintar(true); // mantenerVista=true: no reencuadrar a los anillos, se queda viendo el departamento completo
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
    // el anclaje por defecto del tooltip de un circulo/poligono es su
    // propio centro -- que es PUNTO, el mismo lugar donde esta el pin. Sin
    // offset, la etiqueta de distancia queda tapando el pin apenas se
    // pasa el mouse cerca. direction:"bottom" + offset la corre debajo,
    // sin taparlo; className:"tooltip-anillo" (CSS) le quita casi todo el
    // padding para que ocupe lo minimo y no alcance a tapar UDS vecinas.
    anillo.bindTooltip(fmtDist(radioExt), { direction: "bottom", offset: [0, 6], className: "tooltip-anillo" });
    ANILLOS.push(anillo);
  });
}

function abrirPopup(id) {
  if (!MAPA) return;
  const m = MARCADOR_POR_ID[id];
  if (!m) {
    // puede pasar desde el bloque de zona: esa tabla lista todas las UDS de
    // la vereda/corregimiento, incluidas las que quedaron fuera del radio de
    // busqueda y por lo tanto no tienen marcador. Al menos se lleva el mapa
    // hasta ella en vez de no hacer nada.
    const p = D.puntos.find(x => String(x.id) === String(id));
    if (p) {
      const div0 = $("#mapaCerc");
      if (div0) div0.scrollIntoView({ block: "center" });
      MAPA.setView([p.y, p.x], Math.max(MAPA.getZoom(), 15), { animate: false });
    }
    return;
  }
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
  // el interruptor de la capa de veredas vive DENTRO de esta fila (ver el
  // marcado), asi que no se puede reescribir con innerHTML de un tirón: eso
  // se lo llevaria por delante junto con su manejador de clic. Se pintan las
  // etiquetas en un contenedor propio y el boton se deja intacto al final.
  let etiquetas = ley.querySelector(".ley-items");
  if (!etiquetas) {
    etiquetas = el("div", "ley-items");
    ley.insertBefore(etiquetas, ley.firstChild);
  }
  etiquetas.innerHTML =
    '<span><i class="pt" style="background:' + COLOR_CON_CUPOS + '"></i>Con cupos disponibles</span>' +
    '<span><i class="pt" style="background:' + COLOR_SIN_CUPOS + '"></i>Sin cupos disponibles (llena)</span>' +
    '<i class="sep"></i>' +
    // las tres zonas, de la mas general a la mas especifica -- misma jerarquia
    // que se ve en el mapa (ver ESTILO_CORR / ESTILO_VEREDA mas arriba).
    // Cuatro entradas, una por cada cosa que el mapa dibuja de verdad: antes
    // eran tres y el contorno de las demas veredas -- que si se pinta -- no
    // aparecia por ningun lado.
    // El trazo dice QUE division es (discontinuo = corregimiento, continuo =
    // vereda) y el grosor/relleno dicen si esta elegida o es solo contexto.
    '<span><i class="zn" style="border:2.5px solid #2F6B10;background:rgba(95,168,41,.18)"></i>Municipio</span>' +
    '<span><i class="zn" style="border:2.5px dashed ' + COLOR_ZONA + ';background:rgba(255,220,47,.22)"></i>Corregimiento</span>' +
    '<span><i class="zn" style="border:2.5px solid ' + COLOR_ZONA + ';background:rgba(255,220,47,.45)"></i>Vereda elegida</span>' +
    '<span><i class="zn" style="border:1.2px solid ' + COLOR_ZONA + ';opacity:.7"></i>Demás veredas</span>';
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

/* ---------------- municipio <- punto (camino inverso a onMunicipioChange) --------------- */
// XOR de todos los anillos, para soportar huecos si algun poligono municipal
// llegara a traerlos (ninguno de los 124 los trae hoy, pero la fuente es un
// geojson externo, no hay garantia futura). Distinto de puntoEnGeom(), que
// usa la forma anidada [poligono][anillo] de las veredas: ahi si se sabe
// cual anillo es exterior y cuales son huecos, y no hace falta el XOR.
function puntoEnPoligono(lat, lon, anillos) {
  let dentro = false;
  anillos.forEach(anillo => { if (puntoEnAnillo(lat, lon, anillo)) dentro = !dentro; });
  return dentro;
}
// Medellin es la unica sin poligono navegable en esta fuente (ver
// generar_datos_cercania.py): se usa su bbox como aproximacion razonable
// nada mas para este chequeo, no para dibujar contorno ni para fitBounds.
function municipioQueContiene(lat, lon) {
  for (const m of D.municipios) {
    if (m.poligono && puntoEnPoligono(lat, lon, m.poligono)) return m;
  }
  const medellin = D.municipios.find(m => m.nombre === "MEDELLIN");
  if (medellin && lon >= medellin.bbox[0] && lon <= medellin.bbox[2] && lat >= medellin.bbox[1] && lat <= medellin.bbox[3]) {
    return medellin;
  }
  return null;
}
// el filtro de municipio ya movia el pin (onMunicipioChange); esto hace el
// camino contrario -- cada vez que el pin cambia de lugar por cualquier via
// (clic en el mapa, arrastre, direccion encontrada, coordenadas escritas a
// mano, o el pin por defecto en Medellin) el campo de municipio se pone al
// dia solo, sin moverlo de nuevo ni relanzar la busqueda (ya se esta
// corriendo desde dentro de buscarYPintar). Si el punto cae fuera de
// cualquier poligono conocido (raro: solo pasa muy cerca de un borde, por
// la simplificacion de los contornos) se deja el municipio que ya estaba.
function sincronizarMunicipioConPunto() {
  if (!PUNTO) return;
  const detectado = municipioQueContiene(PUNTO.lat, PUNTO.lon);
  if (!detectado || detectado.nombre === (MUNI && MUNI.nombre)) return;
  MUNI = detectado;
  $("#inputMunicipio").value = detectado.nombre;
  const inputDir = $("#inputDir"), btnBuscar = $("#btnBuscar"), btnPartes = $("#btnBuscarPartes");
  inputDir.disabled = false; btnBuscar.disabled = false; btnPartes.disabled = false;
  inputDir.placeholder = "Dirección en " + detectado.nombre + ": Calle 45 # 23-10...";
  dibujarPoligonoMunicipio(); // solo redibuja el contorno resaltado, no mueve ni hace zoom del mapa
  // el pin cambio de municipio -> las listas de corregimiento/vereda tienen
  // que pasar a las de ESE municipio, y el contorno veredal de contexto
  // tambien (si no, se quedarian mostrando las del municipio anterior).
  TERRITORIO = null;
  VER_TODAS_VEREDAS = false; // cambiar de municipio reinicia el encadenamiento de filtros
  habilitarFiltrosTerritorio(true);
  limpiarListasTerritorio();
  dibujarVeredasContexto();
}

// bloque "UDS dentro de <zona>", arriba de los grupos por banda de distancia.
// Deliberadamente NO filtra por el radio de la busqueda: lista todas las UDS
// que caen dentro del poligono, incluso las que quedaron mas lejos que el
// radio que termino usando la cercania.
function pintarBloqueTerritorio(cont) {
  if (!TERRITORIO) return;
  const esCorr = TERRITORIO.tipo === "corr";
  const z = esCorr ? V.corregimientos[TERRITORIO.idx] : V.veredas[TERRITORIO.idx];
  const lista = udsDeZona(TERRITORIO);
  const caja = el("section", "bloque-territorio");
  const cupos = lista.reduce((s, p) => s + (p.cu || 0), 0);
  const disp = lista.reduce((s, p) => s + Math.max(0, disponibles(p)), 0);
  const tipoTxt = esCorr ? "Corregimiento"
    : (z.t && z.t !== "VE" ? (TIPO_TERRITORIO[z.t] || "Vereda") : "Vereda");
  const head = el("header");
  head.innerHTML =
    '<span class="bt-tipo">' + esc(tipoTxt) + "</span>" +
    '<span class="bt-nombre">' + esc(z.n) + "</span>" +
    '<span class="bt-badges">' +
    "<span>" + lista.length + (lista.length === 1 ? " UDS" : " UDS") + "</span>" +
    "<span>" + mil(cupos) + " cupos</span>" +
    "<span>" + mil(disp) + " disponibles</span>" +
    "</span>";
  caja.appendChild(head);
  // La descarga a Excel vive en un unico lugar: a la derecha del titulo
  // "Resultados" (ver buscarYPintar). Este bloque llego a tener su propio
  // boton y se quito a proposito -- dos botones identicos a media pantalla
  // de distancia obligaban a leer cual exportaba que, y la cabecera de
  // zona quedaba recargada.
  if (!lista.length) {
    caja.appendChild(el("p", "nota", "No hay ninguna UDS georreferenciada dentro de " +
      (esCorr ? "este corregimiento" : "esta vereda") +
      ". Las unidades más cercanas aparecen abajo, agrupadas por distancia."));
  } else {
    const cols = [
      { label: "Código", get: p => p.id != null ? String(p.id) : "—", numeric: false },
      { label: "Nombre UDS", get: p => p.n || "(sin nombre)", numeric: false },
      { label: "Entidad", get: p => p.en || "—", numeric: false },
      { label: "Municipio", get: p => p.mun || "—", numeric: false },
      { label: "Vereda", get: p => nombreVeredaDeUds(p.id) || "—", numeric: false },
      { label: "Dirección", get: p => p.dir || "—", numeric: false },
      { label: "Teléfono", get: p => p.tel || "—", numeric: false },
      { label: "Cupos", get: p => p.cu, fmt: p => mil(p.cu) },
      { label: "Atendidos", get: p => p.at, fmt: p => mil(p.at) },
      { label: "Disponibles", get: p => disponibles(p), fmt: p => chipCupos(p) },
      { label: "Distancia al pin", get: p => distMetros(PUNTO.lat, PUNTO.lon, p.y, p.x), fmt: p => fmtDist(distMetros(PUNTO.lat, PUNTO.lon, p.y, p.x)) },
    ];
    const cuerpo = el("div", "bt-cuerpo");
    // se ordena por distancia al pin igual que las tablas de abajo, para que
    // el orden se sienta consistente en toda la pagina.
    cuerpo.appendChild(tabla(cols, lista, {
      sortCol: 10, sortAsc: true, getId: p => p.id, onRowClick: p => abrirPopup(p.id),
    }));
    caja.appendChild(cuerpo);
  }
  cont.appendChild(caja);
}

function buscarYPintar(mantenerVista) {
  const resWrap = $("#resultados");
  const sub = $("#subResultados");
  RES_MARKERS.forEach(m => MAPA && MAPA.removeLayer(m));
  RES_MARKERS = [];
  MARCADOR_POR_ID = {};
  // los marcadores viejos ya no existen: ningun hover en curso sigue siendo
  // valido. Se usa limpiarInfo() y no un innerHTML suelto para que tambien
  // se caiga la clase .zona -- si no, el panel se quedaba con el fondo
  // amarillo de zona mostrando el texto de "pasa el cursor...".
  HOVER_UDS = false;
  ZONA_HOVER = -1;
  limpiarInfo();
  const dlWrap = $("#descargaResultados");
  if (dlWrap) dlWrap.innerHTML = "";
  if (!PUNTO) {
    resWrap.innerHTML = '<p class="nota">Elige un municipio y marca un punto para ver las unidades de servicio más cercanas.</p>';
    sub.textContent = "";
    ANILLOS.forEach(a => MAPA && MAPA.removeLayer(a));
    ANILLOS = [];
    return;
  }
  actualizarLatLon();
  sincronizarMunicipioConPunto();
  sincronizarTerritorioConPunto();
  const { items, radioFinal } = buscarCercanas(PUNTO.lat, PUNTO.lon);
  const bandas = bandasDe(radioFinal);
  BANDAS_ACTUALES = bandas;
  dibujarAnillos(bandas);
  // el zoom fijo de colocarPin (14/12) no tiene en cuenta que radioFinal es
  // adaptativo (500 m a 100 km, ver buscarCercanas) -- en una zona rural
  // dispersa ese zoom fijo dejaba los anillos mas exteriores bien afuera
  // del recuadro visible. Reencuadrar al anillo mas externo (ANILLOS[0]:
  // dibujarAnillos los push de afuera hacia adentro) muestra siempre el
  // radio de busqueda completo, y fitBounds ya elige el zoom mas cercano
  // posible que lo deje entero a la vista -- ni mas lejos ni mas cerca de
  // lo necesario.
  if (MAPA && ANILLOS.length && !mantenerVista) {
    // fitBounds elige el mayor zoom ENTERO donde el anillo entra completo
    // sin recortarse ni un pixel -- eso deja margen de sobra (reportado:
    // "el zoom... aguanta otro scroll de zoom mas", es decir, se podia
    // acercar un nivel mas y el anillo se seguia viendo bien). +1 nivel
    // de zoom despues del fitBounds, mismo centro: un poco mas cerca de
    // lo estrictamente necesario para que quepa, sin llegar a un zoom
    // exagerado.
    MAPA.fitBounds(ANILLOS[0].getBounds(), { padding: [6, 6], animate: false });
    MAPA.setZoom(MAPA.getZoom() + 1, { animate: false });
  }
  sub.textContent = items.length
    ? items.length + (items.length === 1 ? " unidad de servicio" : " unidades de servicio") + " en un radio de " + fmtDist(radioFinal)
    : "";
  // exporta TODAS las UDS del radio de esta busqueda (las tres bandas
  // juntas), que es lo que esta seccion muestra. El bloque de zona, mas
  // arriba, tiene su propio boton con su propio alcance.
  if (dlWrap && items.length) {
    dlWrap.appendChild(botonDescargaExcel(
      () => items.map(x => x.p),
      () => (MUNI ? MUNI.nombre + " " : "") + "radio " + fmtDist(radioFinal)));
  }

  resWrap.innerHTML = "";
  // el bloque de la zona va PRIMERO y es independiente del radio: responde
  // "que UDS hay dentro de esta vereda/corregimiento", no "cuales quedaron
  // cerca del pin". Los grupos por banda de distancia siguen debajo.
  pintarBloqueTerritorio(resWrap);
  if (!items.length) {
    resWrap.appendChild(el("p", "nota", "No se encontró ninguna UDS con coordenada en un radio de " + fmtDist(radioFinal) + " de ese punto."));
  } else {
    const cols = [
      { label: "Código", get: x => x.p.id != null ? String(x.p.id) : "—", numeric: false },
      { label: "Nombre UDS", get: x => x.p.n || "(sin nombre)", numeric: false },
      { label: "Entidad", get: x => x.p.en || "—", numeric: false },
      { label: "Centro Zonal", get: x => (x.p.cz || "—").replace(/^CZ\s*/, ""), numeric: false },
      { label: "Municipio", get: x => x.p.mun || "—", numeric: false },
      { label: "Corregimiento", get: x => nombreCorrDeUds(x.p.id) || "—", numeric: false },
      { label: "Vereda", get: x => nombreVeredaDeUds(x.p.id) || "—", numeric: false },
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
      // sortCol 12 = "Distancia" (se corrio 2 puestos al insertar
      // Corregimiento y Vereda despues de Municipio, arriba)
      cuerpo.appendChild(tabla(cols, g.items, {
        sortCol: 12, sortAsc: true, getId: x => x.p.id,
        onRowClick: x => abrirPopup(x.p.id),
        claseFila: x => (enZonaActual(x.p.id) ? "fila-en-territorio" : null),
      }));
      det.appendChild(cuerpo);
      resWrap.appendChild(det);
    });
  }

  if (MAPA) {
    items.forEach(({ p, d }) => {
      const color = colorCupos(p);
      const m = L.circleMarker([p.y, p.x], { radius: 6, color: "#fff", weight: 1.5, fillColor: color, fillOpacity: 0.9 }).addTo(MAPA);
      // al pasar el mouse (resumen rapido, sin clic) se llena el panel fijo
      // #infoUds, arriba del mapa -- ver contenidoInfoUds() e INFO_UDS_VACIO
      // mas arriba para el porque de usar un panel fijo en vez de un
      // tooltip flotante. Distinto del popup de abajo (con clic, mas
      // completo, se abre sobre el mapa mismo).
      m.on("mouseover", () => { HOVER_UDS = true; mostrarInfoUds(p); });
      m.on("mouseout", (e) => {
        HOVER_UDS = false;
        // al salir del punto el cursor sigue sobre el mapa: en vez de dejar
        // el panel vacio, se vuelve a mostrar la zona que hay debajo.
        ZONA_HOVER = -1;
        const ll = e && e.latlng;
        if (ll) actualizarHoverZona(ll.lat, ll.lng); else limpiarInfo();
      });
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
        // el clic queda reservado para ir a la fila (resaltarFila) -- el
        // resumen rapido ya lo cubre el tooltip al pasar el mouse (hover),
        // sin competir con un popup que se queda abierto hasta cerrarlo a
        // mano. bindPopup() se deja igual mas abajo porque abrirPopup()
        // (camino inverso: clic en la fila -> se abre en el mapa) todavia
        // lo necesita.
        resaltarFila(p.id);
      });
      if (p.id != null) MARCADOR_POR_ID[p.id] = m;
      RES_MARKERS.push(m);
    });
    // UDS que estan dentro de la zona elegida pero quedaron FUERA del radio de
    // busqueda: sin esto la tabla del bloque de zona listaria unidades que no
    // aparecen por ninguna parte del mapa. Se dibujan con anillo amarillo (el
    // color de territorio) y mas pequenas, para que se lean como "de esta
    // vereda, pero no entre las mas cercanas".
    udsDeZona(TERRITORIO).forEach(p => {
      if (MARCADOR_POR_ID[p.id]) return;
      const m = L.circleMarker([p.y, p.x], {
        radius: 5, color: COLOR_ZONA, weight: 2, fillColor: colorCupos(p), fillOpacity: 0.85,
      }).addTo(MAPA);
      m.on("mouseover", () => { HOVER_UDS = true; mostrarInfoUds(p); });
      m.on("mouseout", (e) => {
        HOVER_UDS = false;
        // al salir del punto el cursor sigue sobre el mapa: en vez de dejar
        // el panel vacio, se vuelve a mostrar la zona que hay debajo.
        ZONA_HOVER = -1;
        const ll = e && e.latlng;
        if (ll) actualizarHoverZona(ll.lat, ll.lng); else limpiarInfo();
      });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); resaltarFila(p.id); });
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
    TERRITORIO = null;
    VER_TODAS_VEREDAS = false;
    pintarCamposTerritorio();
    habilitarFiltrosTerritorio(false);
    $("#listaCorregimientos").innerHTML = ""; $("#listaVeredas").innerHTML = "";
    dibujarZona(false);
    dibujarPoligonoMunicipio();
    dibujarVeredasContexto();
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
  // cambio de municipio: se sueltan corregimiento/vereda anteriores y las dos
  // listas pasan a las de este municipio. La vereda concreta la vuelve a
  // deducir sincronizarTerritorioConPunto en cuanto el pin quede puesto.
  TERRITORIO = null;
  VER_TODAS_VEREDAS = false; // cambiar de municipio reinicia el encadenamiento de filtros
  pintarCamposTerritorio();
  habilitarFiltrosTerritorio(true);
  limpiarListasTerritorio();
  dibujarZona(false);
  dibujarVeredasContexto();
  // contorno real del municipio (si el geojson lo trae -- todos menos
  // Medellin, que ahi queda subdividido en comunas, ver generar_datos_
  // cercania.py): se usa su propio getBounds() para el fitBounds, mas
  // ajustado que el bbox rectangular (que es solo la nube de puntos UDS
  // con margen, y en municipios grandes con UDS agrupadas en una zona
  // puede quedar muy lejos del borde real).
  const poligono = dibujarPoligonoMunicipio();
  // animate:false, igual que el resto de encuadres de este archivo: una
  // animacion de fitBounds sigue corriendo despues de que la funcion retorna
  // y pisa cualquier encuadre posterior. Se detecto al elegir un municipio e
  // inmediatamente despues un corregimiento: el zoom a la zona quedaba
  // deshecho por la animacion del municipio, que terminaba mas tarde.
  if (MAPA) {
    if (poligono) {
      MAPA.fitBounds(poligono.getBounds(), { padding: [8, 8], animate: false });
    } else {
      const bb = MUNI.bbox;
      MAPA.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]], { padding: [4, 4], animate: false });
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
  // al enfocar siempre se ve la lista completa (los 125 municipios, con
  // scroll), incluso si ya hay un municipio elegido y su nombre completo
  // esta escrito en el campo -- si no, filtrar por ese mismo texto solo
  // mostraba esa unica coincidencia, obligando a borrar todo a mano antes
  // de poder elegir uno distinto. select() de paso deja el texto
  // seleccionado, listo para sobreescribirlo con solo empezar a escribir.
  inputMuni.onfocus = () => { inputMuni.select(); renderListaMunicipios(""); };
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

  // los dos filtros territoriales: mismo patron hibrido select+buscador del
  // campo de municipio (clic sin escribir = lista completa, escribir filtra en
  // vivo sin distinguir mayusculas ni tildes), acotados al municipio actual.
  [["#inputCorregimiento", "#listaCorregimientos", renderListaCorregimientos],
   ["#inputVereda", "#listaVeredas", renderListaVeredas]].forEach(([sel, selLista, render]) => {
    const inp = $(sel);
    inp.oninput = () => render(inp.value);
    inp.onfocus = () => { inp.select(); render(""); };
    inp.onkeydown = (e) => {
      if (e.key === "Enter") {
        const primero = $(selLista + " .candidato");
        if (primero) primero.click();
      } else if (e.key === "Escape") {
        inp.blur();
      }
    };
    // mismo timeout que el campo de municipio: en un clic, blur se dispara
    // antes que el onclick del boton candidato -- sin la espera, la lista se
    // vacia antes de que la seleccion alcance a correr.
    inp.onblur = () => setTimeout(() => {
      $(selLista).innerHTML = "";
      pintarCamposTerritorio(); // si escribio algo y no eligio nada, se restaura el valor real
    }, 150);
  });
  $("#btnVeredasMuni").onclick = () => {
    VER_VEREDAS_CTX = !VER_VEREDAS_CTX;
    $("#btnVeredasMuni").textContent = VER_VEREDAS_CTX
      ? "Ocultar el contorno de las demás veredas"
      : "Mostrar el contorno de las demás veredas";
    dibujarVeredasContexto();
  };

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
    "<dt>Veredas y corregimientos</dt><dd>" + esc(V.meta.fuente) + " — " + mil(V.meta.n_veredas) + " polígonos veredales agrupados en " + V.meta.n_corregimientos + " corregimientos, sobre los 125 municipios. En esta fuente no existe una capa de corregimientos aparte: cada registro es una vereda que declara a qué corregimiento pertenece, así que el contorno del corregimiento se obtiene uniendo (disolviendo) las veredas que lo componen, sin los bordes internos. El listado incluye además de las veredas propiamente dichas la cabecera municipal, centros poblados, caseríos, resguardos y áreas protegidas, identificados con su tipo en el desplegable.</dd>" +
    "<dt>A qué vereda pertenece cada UDS</dt><dd>Se calcula al construir el sitio, cruzando la coordenada de cada UDS contra los polígonos a <b style=\"display:inline;font-weight:700\">precisión completa</b> (3,2 millones de vértices). De las " + mil(D.meta.n_uds) + " UDS activas con coordenada, " + mil(V.meta.n_uds_asignadas) + " quedaron ubicadas dentro de una vereda (" + mil(V.meta.n_uds_dentro) + " estrictamente dentro del polígono y " + V.meta.n_uds_por_cercania + " asignadas a la vereda más cercana, a menos de " + V.meta.tolerancia_m + " m, por caer justo sobre un borde). " + (V.meta.n_uds_sin_vereda ? V.meta.n_uds_sin_vereda + " UDS no se pudieron ubicar en ninguna vereda: su coordenada capturada en campo cae fuera del departamento o a decenas de kilómetros del municipio que declaran, y aparecen sin vereda en las tablas." : "Todas quedaron ubicadas.") + " El contorno que se dibuja en pantalla sí está simplificado (unos " + V.meta.simplificacion_m + " m) para que la página cargue liviana, pero eso solo afecta al dibujo — nunca a la vereda que se le atribuye a cada UDS.</dd>" +
    "<dt>Filtros de corregimiento y vereda</dt><dd>Funcionan igual que el de municipio y en ambos sentidos: al elegir una zona el pin salta a un punto interior de ese polígono y el mapa se ajusta a él; y al mover el pin por cualquier vía (clic, arrastre, dirección o coordenadas) los dos campos se actualizan solos para indicar en qué vereda quedó. El punto donde cae el pin es un punto interior garantizado, no el centro geométrico: en una vereda alargada o con forma de herradura —comunes siguiendo un río o una cuchilla— el centro geométrico cae fuera del propio polígono. El bloque \"UDS dentro de…\" de los resultados lista todas las unidades de esa zona sin importar la distancia, incluso las que quedaron más lejos que el radio de la búsqueda por cercanía.</dd>" +
    "<dt>Municipio declarado vs. municipio real</dt><dd>" + V.meta.n_uds_muni_discrepante + " UDS tienen una coordenada que cae en un municipio distinto del que declaran en la base de cobertura. No se corrige ninguna: las tablas siguen mostrando el municipio declarado, y la vereda corresponde al polígono donde realmente cae el punto. La diferencia casi siempre viene de un error de digitación en la captura de la coordenada en campo.</dd>" +
    "<dt>Pin por defecto</dt><dd>Al abrir la página el pin ya está puesto en Medellín (capital del departamento) y el mapa se ve con el zoom suficiente para mostrar Antioquia completo, con el contorno tenue de los 124 municipios con polígono disponible, para poder ubicar el punto arrastrando el pin o haciendo clic sin necesidad de elegir un municipio antes. Al elegir un municipio, el pin salta al casco urbano (cabecera municipal, tomado de \"COORDENADAS MUNICIPIOS.xlsx\") — no al centro geométrico del contorno, que en municipios alargados o con corregimientos dispersos puede caer en zona rural despoblada — y ese contorno se resalta con trazo más marcado sobre el de los demás.</dd>" +
    "<dt>Coordenadas (latitud/longitud)</dt><dd>Los campos de latitud/longitud, debajo del formulario por partes, siempre reflejan el punto marcado (sin importar cómo se haya puesto: municipio, dirección, clic, arrastre o los campos mismos) y también permiten ubicar el punto directamente si ya se tienen las coordenadas, sin depender del geocodificador ni de internet.</dd>" +
    "<dt>Búsqueda de dirección</dt><dd>Usa el geocodificador gratuito de OpenStreetMap (Nominatim), acotado al municipio elegido; es un servicio externo en vivo y necesita conexión a internet. Nominatim no tiene numeración predial en Colombia (ubica la vía completa, no el número exacto de la puerta) y su buscador puede no encontrar nada si el número y el barrio/vereda van juntos en el mismo texto; por eso, si la búsqueda completa no encuentra nada, se reintenta automáticamente con versiones más simples (sin el complemento, sin la placa) — cuando eso pasa se avisa en el mensaje, y toca ajustar el pin arrastrándolo hasta el punto exacto. Ubicar el punto manualmente en el mapa no depende de internet salvo por la carga de los mapas base.</dd>" +
    "<dt>Radio de búsqueda</dt><dd>Adaptativo: empieza en 500 m y va ampliando (1, 2, 5, 10, 20, 50, 100 km) hasta encontrar al menos " + MIN_RESULTADOS + " UDS o llegar al tope — así una zona rural dispersa no se queda sin resultados. Los resultados se agrupan en 3 bandas (cerca / media / lejos), calculadas como tercios del radio que terminó usando cada búsqueda.</dd>" +
    "<dt>Color de cada UDS (mapa, tabla y pines)</dt><dd>Refleja disponibilidad de cupos, no distancia: <b style=\"display:inline;font-weight:700;color:#5FA829\">verde</b> = tiene cupos disponibles (cupos contratados por encima de los atendidos), <b style=\"display:inline;font-weight:700;color:#D64545\">rojo</b> = sin cupos disponibles (llena o sobre-ejecutada). La cercanía (bandas/anillos) solo agrupa los resultados, no cambia su color.</dd>" +
    "<dt>Este sitio, en relación con el tablero de Medellín</dt><dd>Reutiliza la misma lógica de geocodificación, distancia (Haversine) y mapa del módulo \"Cercanía\" del tablero de Buen Comienzo Medellín, extendida a las " + mil(D.meta.n_uds) + " UDS de ICBF-Cuéntame en todo el departamento. No incluye las Sedes de Buen Comienzo (exclusivas de Medellín).</dd>";

  $("#pieBuild").innerHTML =
    '<span class="linea-inst">' + esc("ICBF Regional Antioquia · Grupo Interno de Trabajo de Prevención - Primera Infancia") + "</span>" +
    '<span class="linea-reporte">' + esc("Reporte de Unidades de Servicio Sistema de Información Cuéntame Agosto 2026") + "</span>" +
    '<span class="autoria">Desarrollado por Juan Pablo Velásquez Gómez</span>';
}

init();
</script>
</body>
</html>
