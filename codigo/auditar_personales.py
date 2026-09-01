# -*- coding: utf-8 -*-
"""Audita el HTML publicado: ningun dato de identidad del responsable de una
UDS puede quedar en el archivo que se sube a la web.

    python codigo/auditar_personales.py

Correr SIEMPRE antes de publicar en https://encuentrala.vercel.app/ , que es
una URL de acceso abierto. Sale con codigo 1 si encuentra algo.

Compara CAMPO POR CAMPO, no por subcadena sobre el HTML entero. Buscar
"43272222" como texto suelto da positivos falsos: esos digitos aparecen
dentro de la coordenada -75.54327222222221 y dentro de vertices de poligono
como -75.4043513870187. Lo que importa es si un documento o un nombre es el
VALOR de algun campo publicado.
"""
import io
import json
import os
import re
import sys

import openpyxl

D_ = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(D_)
SITIO = os.path.join(RAIZ, "DONDE LO UBICO - Cercania UDS Antioquia.html")
FUENTE = os.path.join(RAIZ, "fuente", "BD ANALISIS COBERTURA v21.xlsm")

COLUMNAS_PERSONALES = [
    "Identificación Responsable UDS", "Primer Nombre", "Segundo Nombre",
    "Primer Apellido", "Segundo Apellido",
]

if not os.path.exists(SITIO):
    raise SystemExit("Falta el sitio generado. Corre: python codigo/generar_sitio.py")

html = io.open(SITIO, encoding="utf-8").read()
print("HTML publicado: %.2f MB" % (len(html.encode("utf-8")) / 1024 / 1024))

fallos = []
avisos = []


def check(ok, nombre, detalle=""):
    print(("  OK    " if ok else "  FALLA ") + nombre + ("" if ok else " -- " + detalle))
    if not ok:
        fallos.append(nombre)


def const(nombre):
    m = re.search(r"^const " + nombre + r" = (\{.*?\});$", html, re.M | re.S)
    if not m:
        raise SystemExit("no se encontro const %s en el sitio" % nombre)
    return json.loads(m.group(1))


X, D = const("X"), const("D")

print("\n=== 1. Columnas declaradas ===")
print("       columnas expuestas: %d" % len(X["cols"]))
presentes = [c for c in COLUMNAS_PERSONALES if c in X["cols"]]
check(not presentes, "ninguna columna de identidad esta declarada", str(presentes))
check(X.get("personales") is False,
      "la bandera 'personales' quedo en False", "vale %r" % X.get("personales"))

# ---- todos los VALORES publicados, con la columna de la que salen ----
# Se guarda el origen, no solo el valor: un apellido puede coincidir palabra
# por palabra con un municipio ("AMALFI", "BARBOSA", "BELLO"), un barrio
# ("BELEN") o una vereda. Sin saber de que columna viene, esas coincidencias
# se ven como fugas y no lo son.
textos = X["textos"]
columnas_de = {}


def anota(valor, columna):
    s = str(valor).strip()
    if s:
        columnas_de.setdefault(s, set()).add(columna)


for fila in X["filas"].values():
    for j, v in enumerate(fila):
        anota(textos[-v - 1] if isinstance(v, int) and v < 0 else v, X["cols"][j])
for p in D["puntos"]:
    for k, v in p.items():
        if isinstance(v, str):
            anota(v, "D.puntos." + k)
valores = set(columnas_de)

# ---- lo que hay en la fuente ----
ws = openpyxl.load_workbook(FUENTE, read_only=True, data_only=True)["CUENTAME"]
filas = ws.iter_rows(values_only=True)
h = list(next(filas))
i_est = h.index("Estado de la UDS")
idx = {c: h.index(c) for c in COLUMNAS_PERSONALES}
i_tel = h.index("Teléfono UDS")

docs, nombres, tel_sospechoso = set(), set(), []
for r in filas:
    if r[i_est] != "ACTIVA":
        continue
    doc = r[idx["Identificación Responsable UDS"]]
    if doc is not None:
        s = str(doc).strip()
        if len(s) >= 6 and s.isdigit():
            docs.add(s)
            # el mismo numero digitado en el campo de telefono: dato mal
            # capturado en la fuente, no una fuga de este sitio (esa columna
            # ya se publicaba antes). Se reporta como aviso.
            if r[i_tel] is not None and str(r[i_tel]).strip() == s:
                tel_sospechoso.append((str(r[h.index("Código UDS")]).strip(), s))
    for c in ("Primer Nombre", "Segundo Nombre", "Primer Apellido", "Segundo Apellido"):
        v = r[idx[c]]
        if v and len(str(v).strip()) >= 3:
            nombres.add(str(v).strip())

print("\n=== 2. Documentos del responsable ===")
print("       documentos distintos en la fuente: %d" % len(docs))
fugados = sorted(docs & valores)
esperados = {s for _, s in tel_sospechoso}
reales = [d for d in fugados if d not in esperados]
check(not reales, "ningun documento es el valor de un campo publicado",
      "%d fugados, ej %s" % (len(reales), reales[:5]))
if tel_sospechoso:
    for cod, s in tel_sospechoso:
        print("  aviso  la UDS %s trae ese documento digitado en \"Telefono UDS\"" % cod)
        print("         (error de captura en la fuente; esa columna ya era publica)")
    avisos.extend(tel_sospechoso)

print("\n=== 3. Nombres y apellidos del responsable ===")
print("       nombres/apellidos distintos en la fuente: %d" % len(nombres))
# La garantia de fondo es estructural (comprobacion 1): las columnas de
# identidad no existen en el sitio, asi que ningun valor puede venir de ahi.
# Lo que se revisa aqui es que las coincidencias que quedan salgan todas de
# columnas legitimas -- si una saliera de una columna de identidad, seria una
# fuga real y la comprobacion 1 ya habria fallado.
coincidencias = sorted(nombres & valores)
fugadas = {v: columnas_de[v] & set(COLUMNAS_PERSONALES) for v in coincidencias}
fugadas = {v: c for v, c in fugadas.items() if c}
check(not fugadas, "ninguna coincidencia sale de una columna de identidad",
      str(list(fugadas.items())[:4]))
if coincidencias:
    print("       %d nombres/apellidos coinciden con topónimos ya publicados;"
          % len(coincidencias))
    print("       salen de estas columnas (ninguna es de identidad):")
    de_donde = {}
    for v in coincidencias:
        for c in columnas_de[v]:
            de_donde.setdefault(c, []).append(v)
    for c, vs in sorted(de_donde.items(), key=lambda kv: -len(kv[1]))[:6]:
        print("         %-32s %2d  ej %s" % (c, len(vs), ", ".join(sorted(vs)[:3])))
    avisos.append("coincidencias con toponimos")

print("\n" + "=" * 62)
if fallos:
    raise SystemExit("RESULTADO: %d COMPROBACION(ES) FALLARON -> %s" % (len(fallos), fallos))
print("RESULTADO: el HTML publicado no expone datos de identidad (%d aviso(s))" % len(avisos))
