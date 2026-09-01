// Produce un .xlsx de prueba usando las funciones REALES del sitio ya
// generado (se extraen del HTML, no son una copia), para que
// verificar_xlsx.py lo abra despues con openpyxl y compare celda por celda.
// No se corre solo: lo invoca verificar_xlsx.py.
import fs from "node:fs";

import path from "node:path";
import { fileURLToPath } from "node:url";
const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SALIDA = process.argv[2];

const html = fs.readFileSync(path.join(RAIZ, "DONDE LO UBICO - Cercania UDS Antioquia.html"), "utf8");
const js = html.replace(/\r\n/g, "\n").match(/<script>\n([\s\S]*)\n<\/script>/)[1];

// se toma el bloque del escritor tal cual quedo en el sitio publicado
function recorte(desdeTexto, hastaTexto, que) {
  const a = js.indexOf(desdeTexto);
  const b = js.indexOf(hastaTexto, a);
  if (a < 0 || b < 0) throw new Error(`no se encontro ${que} en el sitio generado`);
  return js.slice(a, b);
}
const bloque = recorte("const CRC_TABLA",
  "/* ---------------- disponibilidad de cupos", "el bloque del escritor xlsx");
// filasCuentameDe() agrega dos columnas propias (corregimiento y vereda del
// mapa veredal) y para eso llama a nombreCorrDeUds/nombreVeredaDeUds, que
// viven mas abajo en el archivo. Se recortan tambien -- del sitio real, no
// como copia aqui -- para que la prueba siga ejercitando el codigo publicado.
const bloqueZona = recorte("function territorioDeUds", "const COLOR_ZONA",
  "las funciones de zona por UDS");

// los datos reales embebidos
function datos(nombre) {
  const m = js.match(new RegExp("^const " + nombre + " = (\\{[\\s\\S]*?\\});$", "m"));
  if (!m) throw new Error(`no se encontro const ${nombre}`);
  return JSON.parse(m[1]);
}
const X = datos("X");
const V = datos("V");

const fn = new Function("X", "V",
  bloqueZona + "\n" + bloque +
  "\nreturn { armarZip, hojaXml, filasCuentameDe, filaCuentame, letraCol, escXml };");
const api = fn(X, V);

// comprobaciones baratas de letraCol antes de nada
const esperado = { 0: "A", 25: "Z", 26: "AA", 51: "AZ", 52: "BA", 55: "BD", 57: "BF" };
for (const [i, l] of Object.entries(esperado)) {
  const got = api.letraCol(Number(i));
  if (got !== l) throw new Error(`letraCol(${i}) = ${got}, se esperaba ${l}`);
}
console.log(`letraCol: OK (referencias de celda hasta ${api.letraCol(X.cols.length + 1)})`);

// se exporta una muestra real: las primeras 40 UDS del reporte
const ids = Object.keys(X.filas).slice(0, 40);
const filas = api.filasCuentameDe(ids.map(id => ({ id })));
console.log(`filas a exportar: ${filas.length} (1 encabezado + ${filas.length - 1} UDS), ${filas[0].length} columnas`);

const blob = api.armarZip([
  { nombre: "[Content_Types].xml", texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
  { nombre: "_rels/.rels", texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
  { nombre: "xl/workbook.xml", texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="CUENTAME" sheetId="1" r:id="rId1"/></sheets></workbook>' },
  { nombre: "xl/_rels/workbook.xml.rels", texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
  { nombre: "xl/worksheets/sheet1.xml", texto: api.hojaXml(filas) },
]);

const buf = Buffer.from(await blob.arrayBuffer());
fs.writeFileSync(SALIDA, buf);
console.log(`escrito ${SALIDA} (${(buf.length / 1024).toFixed(0)} KB)`);

// se deja tambien lo que DEBERIA leerse, para comparar celda por celda
fs.writeFileSync(SALIDA + ".esperado.json", JSON.stringify(filas), "utf8");
