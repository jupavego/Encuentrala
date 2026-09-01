# -*- coding: utf-8 -*-
"""Extrae la hoja CUENTAME completa (las 56 columnas) de las UDS ACTIVAS y la
deja en recursos/datos_cuentame.json, para que el sitio pueda entregar por
descarga un .xlsx con las mismas filas y columnas del reporte original,
acotado a lo que el usuario tenga en pantalla.

ATENCION -- DATOS PERSONALES
============================
Estas columnas incluyen la identificacion y el nombre completo del responsable
de cada UDS (columnas "Identificacion Responsable UDS", "Primer Nombre",
"Segundo Nombre", "Primer Apellido", "Segundo Apellido"), y el sitio las
embebe en el HTML publicado. Cruzadas con "Direccion UDS", las coordenadas y
"Hogar Funciona En Su Vivienda", identifican a ~4.300 personas y la ubicacion
de su vivienda.

El HTML resultante NO debe quedar en una URL de acceso publico sin control de
acceso. Ver la seccion correspondiente del README.

Para generar una version sin datos personales, poner INCLUIR_DATOS_PERSONALES
en False aqui abajo y volver a correr este script y generar_sitio.py.

PESO: se usa una tabla de cadenas compartidas (mismo principio que
sharedStrings.xml de xlsx). Los valores de texto se repiten muchisimo entre
filas -- entidad contratista, municipio, servicio, centro zonal -- asi que
guardarlos una sola vez y referenciarlos por indice reduce el JSON a menos de
la mitad frente a repetir cada cadena en cada fila.
"""
import datetime
import io
import json
import os

import openpyxl

D = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(D)
FUENTE = os.path.join(RAIZ, "fuente", "BD ANALISIS COBERTURA v21.xlsm")
DATOS_CERC = os.path.join(RAIZ, "recursos", "datos_cercania.json")
OUT = os.path.join(RAIZ, "recursos", "datos_cuentame.json")

INCLUIR_DATOS_PERSONALES = True

COLUMNAS_PERSONALES = [
    "Identificación Responsable UDS",
    "Primer Nombre",
    "Segundo Nombre",
    "Primer Apellido",
    "Segundo Apellido",
]

wb = openpyxl.load_workbook(FUENTE, read_only=True, data_only=True)
ws = wb["CUENTAME"]
filas = ws.iter_rows(min_row=1, values_only=True)
header = list(next(filas))

i_estado = header.index("Estado de la UDS")
i_codigo = header.index("Código UDS")

# indices de columna que se conservan, en el orden original de la hoja
omitidas = [] if INCLUIR_DATOS_PERSONALES else COLUMNAS_PERSONALES
mantener = [i for i, h in enumerate(header) if h and h not in omitidas]
cols = [header[i] for i in mantener]
if omitidas:
    print("Columnas omitidas por datos personales: %s" % omitidas)
else:
    print("ATENCION: se incluyen datos personales (%s)" % ", ".join(COLUMNAS_PERSONALES))


def limpio(v):
    """Valor listo para JSON. Las horas/fechas de la hoja llegan como objetos
    de datetime y no son serializables tal cual; se pasan a texto con el mismo
    aspecto que tienen en Excel."""
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):
        return v.strftime("%d/%m/%Y %H:%M") if (v.hour or v.minute) else v.strftime("%d/%m/%Y")
    if isinstance(v, datetime.date):
        return v.strftime("%d/%m/%Y")
    if isinstance(v, datetime.time):
        return v.strftime("%H:%M:%S")
    return v


# ---- tabla de cadenas compartidas ----
# cada valor queda como numero (se guarda tal cual) o como indice negativo a
# la tabla de textos: -1 -> textos[0], -2 -> textos[1]... Se usa el negativo
# para distinguirlo de un numero real sin tener que envolver nada en objetos.
textos = []
indice_texto = {}


def cod(v):
    v = limpio(v)
    if isinstance(v, bool):
        v = "SI" if v else "NO"
    if isinstance(v, (int, float)):
        return v
    v = str(v)
    if v == "":
        return 0
    i = indice_texto.get(v)
    if i is None:
        i = len(textos)
        textos.append(v)
        indice_texto[v] = i
    return -(i + 1)


datos = {}
n = 0
for r in filas:
    if r[i_estado] != "ACTIVA":
        continue
    codigo = r[i_codigo]
    if codigo is None:
        continue
    datos[str(codigo).strip()] = [cod(r[i]) for i in mantener]
    n += 1

# cruce con las UDS que el sitio ya conoce: si una UDS del mapa no tuviera
# fila aqui, su descarga saldria vacia sin avisar.
with io.open(DATOS_CERC, encoding="utf-8") as f:
    ids_sitio = {p["id"] for p in json.load(f)["puntos"]}
faltan = ids_sitio - set(datos)
if faltan:
    raise SystemExit(
        "Hay %d UDS en datos_cercania.json sin fila en CUENTAME (ej. %s).\n"
        "Los dos archivos salen de la misma hoja, asi que esto solo pasa si se\n"
        "regenero uno y el otro no: vuelve a correr generar_datos_cercania.py."
        % (len(faltan), list(faltan)[:5])
    )

salida = {
    "cols": cols,
    "textos": textos,
    "filas": datos,
    "personales": INCLUIR_DATOS_PERSONALES,
    "build": datetime.datetime.now().strftime("%d-%m-%Y %H:%M"),
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
s = json.dumps(salida, ensure_ascii=False, separators=(",", ":"))
with io.open(OUT, "w", encoding="utf-8") as f:
    f.write(s)

crudo = sum(len(str(limpio(v))) for fila in datos.values() for v in fila)
print("Filas ACTIVA: %d  |  columnas: %d  |  cadenas distintas: %d"
      % (n, len(cols), len(textos)))
print("JSON: %d KB -> %s" % (len(s.encode("utf-8")) // 1024, OUT))
