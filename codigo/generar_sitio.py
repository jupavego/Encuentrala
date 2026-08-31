# -*- coding: utf-8 -*-
"""
Arma "DONDE LO UBICO - Cercania UDS Antioquia.html" en la raiz del proyecto,
inyectando en la plantilla (tpl_head.html + tpl_tail.js) los dos conjuntos de
datos ya procesados:

  recursos/datos_cercania.json  (generar_datos_cercania.py) -> const D
  recursos/datos_veredas.json   (generar_datos_veredas.py)  -> const V

Ambos se cruzan por "Codigo UDS", asi que tienen que venir de la misma corrida
de datos_cercania.json -- si se regenera ese, hay que volver a correr
generar_datos_veredas.py antes de este script (ver la comprobacion de abajo).
"""
import io
import json
import os

D = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(D)
PLANT = os.path.join(D, "plantilla")
DATOS = os.path.join(RAIZ, "recursos", "datos_cercania.json")
DATOS_VER = os.path.join(RAIZ, "recursos", "datos_veredas.json")
FAVICON_B64 = os.path.join(D, "favicon_b64.txt")
OUT = os.path.join(RAIZ, "DONDE LO UBICO - Cercania UDS Antioquia.html")

with io.open(DATOS, encoding="utf-8") as f:
    datos_str = f.read()
with io.open(DATOS_VER, encoding="utf-8") as f:
    veredas_str = f.read()

# los dos JSON se cruzan por Codigo UDS: si datos_cercania.json se regenero
# despues de datos_veredas.json, la asignacion de veredas puede quedar
# apuntando a UDS que ya no existen (o faltarle las nuevas). Se avisa fuerte
# en vez de armar un sitio con el filtro de vereda a medias.
_d = json.loads(datos_str)
_v = json.loads(veredas_str)
_ids = {p["id"] for p in _d["puntos"]}
_huerfanas = [i for i in _v["uds"] if i not in _ids]
_sin_asignar = len(_ids) - len(_ids & set(_v["uds"]))
if _huerfanas or _sin_asignar > _v["meta"]["n_uds_sin_vereda"]:
    raise SystemExit(
        "datos_veredas.json esta desfasado de datos_cercania.json "
        "(%d UDS asignadas que ya no existen, %d UDS sin asignacion). "
        "Corre primero: python codigo/generar_datos_veredas.py"
        % (len(_huerfanas), _sin_asignar)
    )
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
marcador_ver = "const V = __VEREDAS__;"
if marcador_ver not in cuerpo:
    raise SystemExit("No se encontro el marcador de veredas en la plantilla: " + marcador_ver)
cuerpo = cuerpo.replace(marcador_ver, "const V = " + veredas_str + ";", 1)
marcador_favicon = "__FAVICON_B64__"
if marcador_favicon not in cuerpo:
    raise SystemExit("No se encontro el marcador del favicon en la plantilla: " + marcador_favicon)
cuerpo = cuerpo.replace(marcador_favicon, favicon_b64)

with io.open(OUT, "w", encoding="utf-8") as f:
    f.write(cuerpo)

print("escrito", OUT, os.path.getsize(OUT) // 1024, "KB")
