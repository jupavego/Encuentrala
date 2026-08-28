# -*- coding: utf-8 -*-
"""
Arma "DONDE LO UBICO - Cercania UDS Antioquia.html" en la raiz del proyecto,
inyectando recursos/datos_cercania.json (generado por
generar_datos_cercania.py) en la plantilla (tpl_head.html + tpl_tail.js).
"""
import io
import os

D = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(D)
PLANT = os.path.join(D, "plantilla")
DATOS = os.path.join(RAIZ, "recursos", "datos_cercania.json")
FAVICON_B64 = os.path.join(D, "favicon_b64.txt")
OUT = os.path.join(RAIZ, "DONDE LO UBICO - Cercania UDS Antioquia.html")

with io.open(DATOS, encoding="utf-8") as f:
    datos_str = f.read()
with io.open(os.path.join(PLANT, "tpl_head.html"), encoding="utf-8") as f:
    head = f.read()
with io.open(os.path.join(PLANT, "tpl_tail.js"), encoding="utf-8") as f:
    tail = f.read()
with io.open(FAVICON_B64, encoding="utf-8") as f:
    favicon_b64 = f.read().strip()

cuerpo = head + tail
marcador = "const D = __DATOS__;"
if marcador not in cuerpo:
    raise SystemExit("No se encontro el marcador de datos en la plantilla: " + marcador)
cuerpo = cuerpo.replace(marcador, "const D = " + datos_str + ";", 1)
marcador_favicon = "__FAVICON_B64__"
if marcador_favicon not in cuerpo:
    raise SystemExit("No se encontro el marcador del favicon en la plantilla: " + marcador_favicon)
cuerpo = cuerpo.replace(marcador_favicon, favicon_b64)

with io.open(OUT, "w", encoding="utf-8") as f:
    f.write(cuerpo)

print("escrito", OUT, os.path.getsize(OUT) // 1024, "KB")
