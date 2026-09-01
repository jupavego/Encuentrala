# -*- coding: utf-8 -*-
"""
Cruza las UDS ya georreferenciadas de "recursos/datos_cercania.json" con el
mapa veredal de Antioquia ("fuente/veredas_antioquia.geojson") y arma
"recursos/datos_veredas.json", que consume el sitio para:

  1. dibujar el contorno de cada vereda y de cada corregimiento, y
  2. filtrar por esas dos categorias, sabiendo que UDS cae dentro de cada una.

POR QUE LEE datos_cercania.json Y NO EL EXCEL: la asignacion solo necesita la
coordenada de cada UDS, que ya quedo resuelta y validada en ese JSON por
generar_datos_cercania.py. Mantener este paso separado tiene dos ventajas:
el cruce geografico (lento: ~1 min de shapely) no se repite cada vez que se
retoca algo del Excel, y un problema en la hoja fuente no bloquea el trabajo
de mapa. El cruce se hace por "Codigo UDS" (unico en los 4328 puntos), no por
posicion en el arreglo, para que reordenar los puntos no desalinee nada.

ORDEN DE EJECUCION:
    python codigo/generar_datos_cercania.py     (si cambio el Excel fuente)
    python codigo/generar_datos_veredas.py      <-- este
    python codigo/generar_sitio.py

PRECISION: la asignacion UDS -> vereda se hace contra los poligonos a
precision COMPLETA (3,2 millones de vertices); la simplificacion de abajo
solo afecta al dibujo, nunca a la clasificacion. Es decir: aunque el contorno
que se ve en pantalla este redondeado, la vereda que se le atribuye a cada
UDS es la exacta.

Requiere shapely (pip install shapely) -- solo en tiempo de construccion, el
sitio final no depende de nada de esto.
"""
import collections
import datetime
import io
import json
import os
import re
import time
import unicodedata

from shapely.geometry import shape, Point, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

D = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(D)
FUENTE_GEO = os.path.join(RAIZ, "fuente", "veredas_antioquia.geojson")
DATOS_CERC = os.path.join(RAIZ, "recursos", "datos_cercania.json")
OUT = os.path.join(RAIZ, "recursos", "datos_veredas.json")

# ~22 m. Solo afecta el DIBUJO (ver nota de precision arriba). A este valor
# los 5084 poligonos pesan ~1,5 MB codificados y conservan la forma real de
# la vereda incluso con zoom fuerte; a ~110 m (el que usan los contornos
# municipales) las veredas pequenas se deforman o casi desaparecen.
EPS = 0.0002

# Tolerancia para reasignar una UDS que no cae dentro de ninguna vereda: pasa
# en puntos sobre el borde mismo (los contornos veredales y la coordenada
# capturada en campo no vienen de la misma fuente) y en la franja costera de
# Uraba. Mas alla de esto se deja sin vereda antes que inventarle una.
TOL_GRADOS = 0.0045  # ~500 m

# Nombre oficial del mapa veredal -> nombre corto que trae "Municipio UDS" en
# el Excel (y por lo tanto datos_cercania.json). Son los unicos 5 que no
# cruzan solos tras normalizar tildes/espacios; los 120 restantes coinciden.
# Nota: generar_datos_cercania.py solo necesita 2 de estos alias porque su
# geojson (antioquia_con_comunas v5) trae ademas una propiedad "name" con el
# nombre corto ya resuelto -- el mapa veredal no tiene ese campo, solo
# MPIO_NOMBR con el nombre oficial largo, asi que aqui hay que listar los 5.
# "SAN PEDRO DE URABA" es un municipio distinto y no colisiona con "SAN PEDRO".
ALIAS = {
    "SANANDRESDECUERQUIA": "SANANDRES",
    "SANPEDRODELOSMILAGROS": "SANPEDRO",
    "ELRETIRO": "RETIRO",
    "ELPENOL": "PENOL",
    "SANVICENTE": "SANVICENTEFERRER",
}


def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def clave_muni(nombre):
    k = norm(nombre)
    return ALIAS.get(k, k)


# Decimales que se conservan de cada coordenada. 4 = malla de ~11 m, lo que
# introduce un error maximo de 5,6 m -- despreciable al lado de los 22 m de
# EPS con los que ya se simplifica el contorno, y ahorra un 34% del peso
# frente a los 5 decimales habituales (medido: 1,50 MB -> 0,99 MB).
# OJO: decodePolyline() en tpl_tail.js tiene que usar el mismo valor.
PRECISION = 4


def encode_polyline(coords, precision=PRECISION):
    """Google encoded polyline sobre [(lat, lon), ...].

    Guardar los anillos como texto codificado en vez de arreglos de numeros
    baja el peso ~6x (de ~21 bytes por vertice a ~3,5): son deltas entre
    puntos consecutivos, en enteros, en base64-ish. El decodificador en el
    navegador son 15 lineas (ver decodePolyline en tpl_tail.js).
    """
    factor = 10 ** precision
    out = []
    plat = plon = 0
    for lat, lon in coords:
        ilat = int(round(lat * factor))
        ilon = int(round(lon * factor))
        for d in (ilat - plat, ilon - plon):
            d = ~(d << 1) if d < 0 else (d << 1)
            while d >= 0x20:
                out.append(chr((0x20 | (d & 0x1F)) + 63))
                d >>= 5
            out.append(chr(d + 63))
        plat, plon = ilat, ilon
    return "".join(out)


def geom_codificada(geom):
    """shapely -> [[anillo_ext, hueco...], [anillo_ext...]] ya simplificado y
    codificado. La estructura anidada es la que Leaflet entiende como
    multi-poligono con huecos: L.polygon([[ext, hueco], [ext2]])."""
    g = geom.simplify(EPS, preserve_topology=True)
    if g.is_empty:
        return []
    polys = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
    fuera = []
    for p in polys:
        if p.is_empty or p.geom_type != "Polygon":
            continue
        anillos = []
        for ring in [p.exterior] + list(p.interiors):
            pts = [(y, x) for x, y in ring.coords]  # geojson trae (lon, lat)
            if len(pts) >= 4:
                anillos.append(encode_polyline(pts))
        if anillos:
            fuera.append(anillos)
    return fuera


def geom_dibujada(geom):
    """La geometria TAL COMO va a quedar dibujada en el mapa: simplificada a
    EPS y con las coordenadas redondeadas a PRECISION decimales, que es lo
    unico que sobrevive a encode_polyline(). Devuelve None si el redondeo la
    degenera."""
    g = geom.simplify(EPS, preserve_topology=True)
    if g.is_empty:
        return None

    def red(ring):
        return [(round(x, PRECISION), round(y, PRECISION)) for x, y in ring.coords]

    partes = []
    for p in (list(g.geoms) if g.geom_type == "MultiPolygon" else [g]):
        if p.is_empty or p.geom_type != "Polygon":
            continue
        try:
            q = Polygon(red(p.exterior), [red(h) for h in p.interiors])
            if not q.is_valid:
                q = q.buffer(0)
            if not q.is_empty:
                partes.append(q)
        except Exception:
            continue  # anillo degenerado tras redondear: se ignora
    if not partes:
        return None
    u = unary_union(partes)
    return None if u.is_empty else u


def punto_interior(geom):
    """Punto garantizado DENTRO del poligono, para poner ahi el pin al elegir
    la vereda/corregimiento en el filtro. No se usa centroid(): en una vereda
    con forma de C o de herradura -- comunes siguiendo un rio o una cuchilla --
    el centroide cae afuera, y el pin terminaria en la vereda vecina.

    Se calcula sobre la geometria DIBUJADA, no sobre la de precision completa:
    el pin es una referencia visual, asi que tiene que quedar dentro del
    contorno que el usuario ve. Calculandolo sobre la completa, 8 veredas y 1
    corregimiento (de los mas delgados, donde simplificar mueve el borde mas
    que el ancho de la figura) terminaban con el pin justo por fuera de su
    propio contorno. Si el redondeo degenera la figura se cae de vuelta a la
    geometria completa, que es mejor que no tener punto."""
    base = geom_dibujada(geom) or geom
    p = base.representative_point()
    return [round(p.y, 6), round(p.x, 6)]


t_ini = time.time()

# ---------------- UDS ya georreferenciadas ----------------
with io.open(DATOS_CERC, encoding="utf-8") as f:
    datos = json.load(f)
puntos = datos["puntos"]
munis_uds = [m["nombre"] for m in datos["municipios"]]
print("UDS georreferenciadas: %d en %d municipios" % (len(puntos), len(munis_uds)))

# ---------------- mapa veredal ----------------
with io.open(FUENTE_GEO, encoding="utf-8") as f:
    geo = json.load(f)
print("features veredales: %d (cargado en %.0fs)" % (len(geo["features"]), time.time() - t_ini))

# indice de municipios: se usan los MISMOS nombres que ya trae
# datos_cercania.json, para que el filtro de municipio del sitio y estos dos
# nuevos filtros hablen el mismo idioma sin traducir nada en el navegador.
muni_por_clave = {clave_muni(n): n for n in munis_uds}
idx_muni = {n: i for i, n in enumerate(munis_uds)}

veredas = []          # (props, geom shapely)
sin_municipio = collections.Counter()
for ft in geo["features"]:
    if ft["geometry"] is None:
        continue
    props = ft["properties"]
    g = shape(ft["geometry"])
    if not g.is_valid:
        g = g.buffer(0)  # corrige auto-intersecciones del geojson de origen
    if g.is_empty:
        continue
    nombre_muni = muni_por_clave.get(clave_muni(props.get("MPIO_NOMBR") or ""))
    if nombre_muni is None:
        sin_municipio[props.get("MPIO_NOMBR")] += 1
        continue
    veredas.append((props, g, nombre_muni))

if sin_municipio:
    print("AVISO - veredas cuyo municipio no existe en datos_cercania.json:",
          dict(sin_municipio))
print("veredas utilizables: %d" % len(veredas))

# ---------------- corregimientos = union de sus veredas ----------------
# En esta fuente NO hay una capa de corregimientos aparte: cada registro es
# una vereda que declara a que corregimiento pertenece (campo CORREGIMIE).
# El poligono del corregimiento se obtiene disolviendo las veredas que lo
# componen -- unary_union borra los bordes internos, asi queda un contorno
# unico y limpio, no 30 veredas dibujadas una encima de otra.
grupos_corr = collections.defaultdict(list)
for props, g, nombre_muni in veredas:
    corr = (props.get("CORREGIMIE") or "").strip()
    if corr:
        grupos_corr[(nombre_muni, corr)].append(g)

t = time.time()
corregimientos = []
idx_corr = {}
for (nombre_muni, corr), gs in sorted(grupos_corr.items()):
    u = unary_union(gs) if len(gs) > 1 else gs[0]
    if u.is_empty:
        continue
    idx_corr[(nombre_muni, corr)] = len(corregimientos)
    corregimientos.append({
        "n": corr,
        "m": idx_muni[nombre_muni],
        "p": punto_interior(u),
        "g": geom_codificada(u),
        "nu": 0,
        "nv": len(gs),
    })
print("corregimientos disueltos: %d (%.0fs)" % (len(corregimientos), time.time() - t))

# ---------------- veredas -> salida ----------------
t = time.time()
veredas_out = []
for props, g, nombre_muni in veredas:
    corr = (props.get("CORREGIMIE") or "").strip()
    veredas_out.append({
        "n": (props.get("VERE_NOMBR") or "(sin nombre)").strip(),
        "m": idx_muni[nombre_muni],
        "cr": idx_corr.get((nombre_muni, corr)),
        "t": (props.get("VERE_TIPO") or "").strip(),
        "cod": (str(props.get("COD_VERE")) if props.get("COD_VERE") else None),
        "p": punto_interior(g),
        "g": geom_codificada(g),
        "nu": 0,
    })
print("veredas codificadas (%.0fs)" % (time.time() - t))

# ---------------- asignacion UDS -> vereda ----------------
# STRtree indexa los 5084 poligonos por su bbox: en vez de probar cada UDS
# contra los 5084 (21 millones de pruebas), se prueban solo los pocos cuyo
# bbox contiene el punto. Contra los poligonos a PRECISION COMPLETA.
t = time.time()
geoms = [g for _, g, _ in veredas]
arbol = STRtree(geoms)
asignacion = {}
n_dentro = n_cercana = 0
sin_vereda = []
for p in puntos:
    pt = Point(p["x"], p["y"])  # x = lon, y = lat
    iv = None
    for cand in arbol.query(pt):
        if geoms[cand].contains(pt):
            iv = int(cand)
            n_dentro += 1
            break
    if iv is None:
        # no cayo dentro de ninguna: se busca la vereda mas cercana dentro de
        # TOL_GRADOS (borde/costa, ver arriba). arbol.nearest devuelve la mas
        # proxima sin limite de distancia, por eso se verifica la distancia
        # despues y se descarta si quedo lejos.
        cand = arbol.nearest(pt)
        if cand is not None and geoms[cand].distance(pt) <= TOL_GRADOS:
            iv = int(cand)
            n_cercana += 1
        else:
            sin_vereda.append(p)
    if iv is None:
        continue
    ic = veredas_out[iv]["cr"]
    asignacion[p["id"]] = [iv, ic] if ic is not None else [iv]
    veredas_out[iv]["nu"] += 1
    if ic is not None:
        corregimientos[ic]["nu"] += 1

print("asignacion UDS (%.0fs): %d dentro, %d por cercania (<=%.0f m), %d sin vereda"
      % (time.time() - t, n_dentro, n_cercana, TOL_GRADOS * 111320, len(sin_vereda)))
if sin_vereda[:5]:
    print("   ej. sin vereda:", [(x["id"], x["mun"], round(x["y"], 4), round(x["x"], 4))
                                 for x in sin_vereda[:5]])

# coherencia municipio-UDS vs municipio-vereda: si difieren, casi siempre es
# una coordenada mal digitada en la captura de campo (la UDS dice estar en un
# municipio pero su punto cae en otro). No se corrige nada, solo se reporta.
discrepan = 0
for p in puntos:
    a = asignacion.get(p["id"])
    if a and munis_uds[veredas_out[a[0]]["m"]] != p["mun"]:
        discrepan += 1
print("UDS cuyo municipio declarado != municipio del poligono donde cae: %d" % discrepan)

# ---------------- salida ----------------
salida = {
    "meta": {
        "fuente": "Mapa Veredal Digital de Antioquia - Departamento Administrativo de "
                  "Planeacion, Gobernacion de Antioquia (Feature Service publico ArcGIS, "
                  "capa Veredas_Antioquia)",
        "n_veredas": len(veredas_out),
        "n_corregimientos": len(corregimientos),
        "n_uds_asignadas": len(asignacion),
        "n_uds_sin_vereda": len(sin_vereda),
        "n_uds_dentro": n_dentro,
        "n_uds_por_cercania": n_cercana,
        "n_uds_muni_discrepante": discrepan,
        "simplificacion_m": round(EPS * 111320),
        "tolerancia_m": round(TOL_GRADOS * 111320),
    },
    "build": datetime.datetime.now().strftime("%d-%m-%Y %H:%M"),
    "municipios": munis_uds,
    "veredas": veredas_out,
    "corregimientos": corregimientos,
    "uds": asignacion,
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
txt = json.dumps(salida, ensure_ascii=False, separators=(",", ":"))
with io.open(OUT, "w", encoding="utf-8") as f:
    f.write(txt)
print("JSON: %d KB -> %s  (total %.0fs)" % (len(txt.encode("utf-8")) // 1024, OUT, time.time() - t_ini))
