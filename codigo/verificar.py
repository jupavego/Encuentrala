# -*- coding: utf-8 -*-
"""Pruebas de humo sobre los dos JSON que consume el sitio.

Correr despues de regenerar los datos y ANTES de publicar:

    python codigo/verificar.py

Sale con codigo 1 si algo falla, para poder encadenarlo con los generadores.

Replica en Python el mismo decodificador de polilineas y el mismo
punto-en-poligono que corren en el navegador (tpl_tail.js), para verificar
que lo que se publica es consistente consigo mismo.
"""
import collections
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RECURSOS = os.path.join(RAIZ, "recursos")
with open(os.path.join(RECURSOS, "datos_cercania.json"), encoding="utf-8") as f:
    C = json.load(f)
with open(os.path.join(RECURSOS, "datos_veredas.json"), encoding="utf-8") as f:
    V = json.load(f)

fallos = []
avisos = []


def check(cond, nombre, detalle=""):
    if cond:
        print("  OK   %s" % nombre)
    else:
        print("  FALLA %s -- %s" % (nombre, detalle))
        fallos.append(nombre)


def aviso(nombre, detalle):
    print("  nota  %s -- %s" % (nombre, detalle))
    avisos.append(nombre)


# ---- mismo decodificador que el navegador ----
def decode_polyline(s, precision=4):  # 4 = PRECISION en generar_datos_veredas.py
    factor = 10.0 ** precision
    pts, i, lat, lon = [], 0, 0, 0
    while i < len(s):
        for eje in range(2):
            shift = result = 0
            while True:
                b = ord(s[i]) - 63; i += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            d = ~(result >> 1) if (result & 1) else (result >> 1)
            if eje == 0:
                lat += d
            else:
                lon += d
        pts.append((lat / factor, lon / factor))
    return pts


def anillos(g):
    """g = [poligono][anillo] = polilinea codificada. El anillo 0 de cada
    poligono es el exterior; los siguientes son huecos."""
    return [[decode_polyline(r) for r in poly] for poly in g]


def punto_en_anillo(lat, lon, anillo):
    dentro = False
    j = len(anillo) - 1
    for i in range(len(anillo)):
        yi, xi = anillo[i]
        yj, xj = anillo[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            dentro = not dentro
        j = i
    return dentro


def punto_en_geom(lat, lon, polys):
    """Misma logica que puntoEnGeom() en tpl_tail.js: dentro del anillo
    exterior de algun poligono y fuera de los huecos de ESE poligono."""
    for poly in polys:
        if not poly or not punto_en_anillo(lat, lon, poly[0]):
            continue
        if not any(punto_en_anillo(lat, lon, poly[k]) for k in range(1, len(poly))):
            return True
    return False


print("\n=== 1. Referencias cruzadas entre los dos JSON ===")
ids_cerc = {p["id"] for p in C["puntos"]}
ids_ver = set(V["uds"])
check(ids_ver <= ids_cerc, "toda UDS con vereda existe en datos_cercania",
      "huerfanas: %s" % list(ids_ver - ids_cerc)[:5])
faltan = ids_cerc - ids_ver
check(len(faltan) == V["meta"]["n_uds_sin_vereda"],
      "el conteo de UDS sin vereda cuadra con meta",
      "meta dice %d, faltan %d" % (V["meta"]["n_uds_sin_vereda"], len(faltan)))
print("       (%d UDS sin vereda, declaradas en meta)" % len(faltan))

print("\n=== 2. Indices validos y coherentes ===")
nv, nc = len(V["veredas"]), len(V["corregimientos"])
# uds[id] es [vereda] o [vereda, corregimiento]: las 23 veredas que la fuente
# trae sin CORREGIMIE no tienen a que apuntar. El JS ya lo contempla
# (comprueba a.length > 1 antes de indexar) -- aqui se verifica que ese sea
# el UNICO motivo por el que falta el segundo elemento.
def par(v):
    return (v[0], v[1] if len(v) > 1 else None)

malos = [k for k, v in V["uds"].items()
         if not (0 <= par(v)[0] < nv)
         or (par(v)[1] is not None and not (0 <= par(v)[1] < nc))]
check(not malos, "todo indice de vereda/corregimiento esta en rango", str(malos[:5]))

incoh = [k for k, v in V["uds"].items() if V["veredas"][par(v)[0]]["cr"] != par(v)[1]]
check(not incoh, "el corregimiento de la UDS = el de su vereda",
      "%d incoherentes, ej %s" % (len(incoh), incoh[:3]))

sin_cr = [k for k, v in V["uds"].items() if len(v) == 1]
check(all(V["veredas"][V["uds"][k][0]]["cr"] is None for k in sin_cr),
      "toda UDS sin corregimiento esta en una vereda que tampoco lo tiene")
print("       (%d UDS sin corregimiento, en veredas que la fuente trae sin ese dato)"
      % len(sin_cr))

mal_m = [i for i, v in enumerate(V["veredas"])
         if v["cr"] is not None and V["corregimientos"][v["cr"]]["m"] != v["m"]]
check(not mal_m, "vereda y su corregimiento comparten municipio",
      "%d discrepan, ej %s" % (len(mal_m), mal_m[:3]))

print("\n=== 3. Contadores precalculados ===")
cnt_v = collections.Counter(v[0] for v in V["uds"].values())
cnt_c = collections.Counter(v[1] for v in V["uds"].values() if len(v) > 1)
mal = [i for i, v in enumerate(V["veredas"]) if v["nu"] != cnt_v.get(i, 0)]
check(not mal, "veredas[i].nu = UDS que realmente apuntan ahi",
      "%d mal, ej %s" % (len(mal), [(i, V['veredas'][i]['nu'], cnt_v.get(i, 0)) for i in mal[:3]]))
mal = [i for i, c in enumerate(V["corregimientos"]) if c["nu"] != cnt_c.get(i, 0)]
check(not mal, "corregimientos[i].nu = UDS que realmente apuntan ahi",
      "%d mal, ej %s" % (len(mal), [(i, V['corregimientos'][i]['nu'], cnt_c.get(i, 0)) for i in mal[:3]]))
nv_por_c = collections.Counter(v["cr"] for v in V["veredas"])
mal = [i for i, c in enumerate(V["corregimientos"]) if c["nv"] != nv_por_c.get(i, 0)]
check(not mal, "corregimientos[i].nv = veredas que le pertenecen", str(mal[:3]))
check(sum(cnt_v.values()) == len(V["uds"]), "sin doble conteo de UDS")

print("\n=== 4. Geometrias: decodifican y caen en Antioquia ===")
# bbox generoso de Antioquia
LAT0, LAT1, LON0, LON1 = 5.0, 9.0, -77.5, -73.5
malas = []
fuera = 0
cortas = 0
total_anillos = 0
for etiqueta, coll in (("vereda", V["veredas"]), ("corregimiento", V["corregimientos"])):
    for i, z in enumerate(coll):
        try:
            ans = anillos(z["g"])
        except Exception as e:
            malas.append((etiqueta, i, str(e)))
            continue
        if not ans or not all(poly for poly in ans):
            malas.append((etiqueta, i, "poligono sin anillos"))
            continue
        for poly in ans:
            for a in poly:
                total_anillos += 1
                if len(a) < 4:
                    cortas += 1
                for lat, lon in a:
                    if not (LAT0 <= lat <= LAT1 and LON0 <= lon <= LON1):
                        fuera += 1
                        break
check(not malas, "todas las geometrias decodifican", str(malas[:3]))
check(fuera == 0, "ningun anillo se sale de Antioquia", "%d anillos fuera" % fuera)
check(cortas == 0, "ningun anillo con menos de 4 puntos", "%d cortos" % cortas)
print("       (%d anillos decodificados en total)" % total_anillos)

print("\n=== 5. El pin de cada zona cae DENTRO de su propio poligono ===")
for etiqueta, coll in (("vereda", V["veredas"]), ("corregimiento", V["corregimientos"])):
    fuera = []
    for i, z in enumerate(coll):
        lat, lon = z["p"]
        if not punto_en_geom(lat, lon, anillos(z["g"])):
            fuera.append((i, z["n"]))
    check(not fuera, "el pin de cada %s esta dentro de su contorno dibujado" % etiqueta,
          "%d fuera de %d, ej %s" % (len(fuera), len(coll), fuera[:4]))

print("\n=== 6. Cobertura por municipio ===")
munis_json = V["municipios"]
check(len(munis_json) == len(C["municipios"]),
      "misma lista de municipios en los dos JSON",
      "%d vs %d" % (len(munis_json), len(C["municipios"])))
sin_ver = [m for i, m in enumerate(munis_json)
           if not any(v["m"] == i for v in V["veredas"])]
check(not sin_ver, "todo municipio tiene al menos una vereda", str(sin_ver[:5]))

print("\n=== 7. La afirmacion concreta: Ituango / El Aro ===")
try:
    im = munis_json.index("ITUANGO")
except ValueError:
    im = -1
check(im >= 0, "ITUANGO existe en la lista de municipios")
if im >= 0:
    corrs = [(i, c) for i, c in enumerate(V["corregimientos"]) if c["m"] == im]
    print("       corregimientos de Ituango:", sorted(c["n"] for _, c in corrs))
    aro = [(i, c) for i, c in corrs if c["n"] == "El Aro"]
    check(len(aro) == 1, "El Aro aparece una sola vez")
    if aro:
        ci, c = aro[0]
        uds_aro = [k for k, v in V["uds"].items() if len(v) > 1 and v[1] == ci]
        pts = {p["id"]: p for p in C["puntos"]}
        cupos = sum(pts[k]["cu"] for k in uds_aro if k in pts)
        aten = sum(pts[k]["at"] for k in uds_aro if k in pts)
        print("       El Aro -> %d UDS, %d cupos, %d atendidos, %d disponibles"
              % (len(uds_aro), cupos, aten, cupos - aten))
        check(len(uds_aro) == 4 and cupos == 41 and cupos - aten == 8,
              "coincide con lo que se le prometio al usuario (4 UDS, 41 cupos, 8 disponibles)")

print("\n=== 8. Calidad de datos (informativo, no es falla del codigo) ===")
disc = []
pts = {p["id"]: p for p in C["puntos"]}
for k, vv in V["uds"].items():
    if k in pts:
        mv = munis_json[V["veredas"][vv[0]]["m"]]
        if mv != pts[k]["mun"]:
            disc.append((k, pts[k]["mun"], mv))
print("       UDS cuyo municipio declarado != municipio de su coordenada: %d" % len(disc))
if len(disc) != V["meta"]["n_uds_muni_discrepante"]:
    aviso("meta.n_uds_muni_discrepante desactualizado",
          "meta dice %d, se contaron %d" % (V["meta"]["n_uds_muni_discrepante"], len(disc)))
for k, a, b in disc[:5]:
    print("         %s: declara %s, cae en %s" % (k, a, b))

print("\n" + "=" * 60)
if fallos:
    print("RESULTADO: %d PRUEBA(S) FALLARON -> %s" % (len(fallos), fallos))
    sys.exit(1)
print("RESULTADO: todas las pruebas de humo pasaron (%d avisos)" % len(avisos))
