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
  "\nreturn { armarZip, hojaXml, partesXlsx, filasCuentameDe, filaCuentame, letraCol, escXml, anchosDe };");
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

// se usa la MISMA funcion que arma el archivo en el navegador, en vez de
// repetir aqui la lista de partes: asi la prueba no puede pasar sobre algo
// distinto de lo que descarga el usuario.
const partes = api.partesXlsx(filas, "CUENTAME");
console.log(`partes del xlsx: ${partes.length} (${partes.map(p => p.nombre).join(", ")})`);
const blob = api.armarZip(partes);

const buf = Buffer.from(await blob.arrayBuffer());
fs.writeFileSync(SALIDA, buf);
console.log(`escrito ${SALIDA} (${(buf.length / 1024).toFixed(0)} KB)`);

// se deja tambien lo que DEBERIA leerse, para comparar celda por celda
fs.writeFileSync(SALIDA + ".esperado.json", JSON.stringify(filas), "utf8");
