# -*- coding: utf-8 -*-
"""
Arma los GeoJSON para la capa de referencia del mapa Azure Maps de Power BI:
municipios, corregimientos, veredas y cabeceras de Antioquia, coloreados por
Centro Zonal ICBF.

Lee solo lo que ya hay en recursos/ (no necesita el geojson crudo de "fuente/"):
  - datos_veredas.json : contornos de veredas y corregimientos + a que vereda
                         cae cada UDS
  - datos_cercania.json: contorno municipal, subregion y Centro Zonal de cada UDS

Salida: powerbi/*.geojson

REGLAS QUE CONVIENE SABER
  * "Cabecera" en el mapa veredal NO es el casco urbano: es el nombre del
    "corregimiento" que agrupa todas las veredas que no pertenecen a un
    corregimiento real (es decir, el resto rural del municipio). Por eso aqui
    NO se dibuja como corregimiento. Las cabeceras de verdad son las 125
    figuras de tipo VERE_TIPO = "CM" (cabecera municipal).
  * Centro Zonal: cada municipio cae en un solo CZ (el que declaran sus UDS),
    salvo MEDELLIN, que tiene 5. El repo no trae las comunas de Medellin, asi
    que alli el CZ se atribuye por mayoria de UDS en cada vereda/corregimiento
    y el casco urbano se parte por proximidad a las UDS de cada CZ (poligonos
    de Voronoi). Esas piezas urbanas llevan aprox_cz = true.

Requiere shapely (pip install shapely).
"""
import collections
import colorsys
import io
import json
import os

from shapely.geometry import MultiPolygon, Polygon, Point, mapping
from shapely.geometry.polygon import orient
from shapely.ops import unary_union, voronoi_diagram

D = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(D)
OUT_DIR = os.path.join(RAIZ, "powerbi")
PRECISION = 4  # igual que el sitio; ~11 m
# Simplificacion extra (grados) de veredas, corregimientos y cabeceras para que
# el archivo completo quepa en lo que el visual de Power BI carga bien (~5 MB).
# 0.0008 ~ 90 m: las veredas pequenas conservan su forma, los bordes se alisan.
SIMPLIFICAR = float(os.environ.get("SIMPLIFICAR", "0.0008"))


# ---------------------------------------------------------------- utilidades
def decode_polyline(s, precision=PRECISION):
    """Inverso de encode_polyline() de generar_datos_veredas.py -> [(lat, lon)]"""
    f = 10 ** precision
    i = lat = lon = 0
    out = []
    while i < len(s):
        for eje in (0, 1):
            r = sh = 0
            while True:
                b = ord(s[i]) - 63
                i += 1
                r |= (b & 0x1F) << sh
                sh += 5
                if b < 0x20:
                    break
            d = ~(r >> 1) if r & 1 else r >> 1
            if eje == 0:
                lat += d
            else:
                lon += d
        out.append((lat / f, lon / f))
    return out


def geom_desde_codificada(g):
    polys = []
    for anillos in g:
        rings = [[(lon, lat) for lat, lon in decode_polyline(a)] for a in anillos]
        try:
            p = Polygon(rings[0], rings[1:])
            if not p.is_valid:
                p = p.buffer(0)
            if not p.is_empty:
                polys.append(p)
        except Exception:
            continue
    if not polys:
        return None
    u = unary_union(polys)
    return None if u.is_empty else u


def a_geojson(geom, sin_simplificar=False):
    """Poligono/multipoligono con anillos exteriores antihorarios (RFC 7946) y
    coordenadas a PRECISION decimales."""
    tol = SIMPLIFICAR / 2 if sin_simplificar else SIMPLIFICAR
    if tol > 0:
        g2 = geom.simplify(tol, preserve_topology=True)
        if not g2.is_empty:
            geom = g2
    partes = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
    partes = [orient(p, 1.0) for p in partes if p.geom_type == "Polygon" and not p.is_empty]
    def rr(ring):
        return [[round(x, PRECISION), round(y, PRECISION)] for x, y in ring.coords]
    polys = [[rr(p.exterior)] + [rr(h) for h in p.interiors] for p in partes]
    if len(polys) == 1:
        return {"type": "Polygon", "coordinates": polys[0]}
    return {"type": "MultiPolygon", "coordinates": polys}


def solo_poligonos(g):
    if g is None or g.is_empty:
        return None
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    ps = [x for x in getattr(g, "geoms", []) if x.geom_type in ("Polygon", "MultiPolygon")]
    return unary_union(ps) if ps else None


# --------------------------------------------------------------------- color
def hsl(h, s, l):
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360.0, max(0, min(1, l)), max(0, min(1, s)))
    return "#%02X%02X%02X" % (round(r * 255), round(g * 255), round(b * 255))


# ------------------------------------------------------------------- lectura
with io.open(os.path.join(RAIZ, "recursos", "datos_veredas.json"), encoding="utf-8") as f:
    V = json.load(f)
with io.open(os.path.join(RAIZ, "recursos", "datos_cercania.json"), encoding="utf-8") as f:
    C = json.load(f)

MUNIS = V["municipios"]
cz_de_uds = {p["id"]: p["cz"] for p in C["puntos"]}
punto_uds = {p["id"]: p for p in C["puntos"]}
info_muni = {m["nombre"]: m for m in C["municipios"]}

# ---- Centro Zonal de cada municipio (por mayoria de sus UDS)
cz_muni_cnt = collections.defaultdict(collections.Counter)
for p in C["puntos"]:
    cz_muni_cnt[p["mun"]][p["cz"]] += 1
CZ_MUNI = {m: c.most_common(1)[0][0] for m, c in cz_muni_cnt.items()}
assert all(m in CZ_MUNI for m in MUNIS), "hay municipios sin ninguna UDS"
MULTI_CZ = {m for m, c in cz_muni_cnt.items() if len(c) > 1}
print("municipios con mas de un CZ:", sorted(MULTI_CZ))

# ---- paleta: un matiz por CZ (se asigna mas abajo, cuando ya hay geometrias,
# para que los CZ que se tocan queden con matices lejanos entre si)
CZS = sorted(set(CZ_MUNI.values()) | {p["cz"] for p in C["puntos"]})
HUE_CZ = {}


def tono_municipio(muni, cz):
    """(matiz, saturacion, luminosidad) base del municipio dentro de su CZ:
    mismo matiz de familia, pero cada municipio unos puntos distinto."""
    hermanos = sorted(m for m in MUNIS if CZ_MUNI[m] == cz or (m in MULTI_CZ and m == muni))
    j = hermanos.index(muni) if muni in hermanos else 0
    n = max(len(hermanos), 1)
    # orden entrelazado (0, n/2, 1, n/2+1 ...) para que vecinos alfabeticos no queden identicos
    orden = (j // 2) + (n + 1) // 2 * (j % 2)
    t = (orden / max(n - 1, 1)) - 0.5          # -0.5 .. 0.5
    return (HUE_CZ[cz] + 10 * t, 0.62 - 0.10 * abs(t), 0.50 + 0.16 * t)


def estilo(capa, muni, cz):
    h, s, l = tono_municipio(muni, cz)
    if capa == "Municipio":
        return dict(fill=hsl(h, s, l + 0.08), stroke=hsl(h, s, l - 0.28), fo=0.45, sw=1.6, so=0.9)
    if capa == "Corregimiento":
        return dict(fill=hsl(h, s, l), stroke=hsl(h, s, l - 0.22), fo=0.55, sw=1.0, so=0.9)
    if capa == "Vereda":
        return dict(fill=hsl(h, s, l + 0.10), stroke=hsl(h, s, l - 0.18), fo=0.50, sw=0.6, so=0.8)
    return dict(fill=hsl(h, s, l - 0.14), stroke=hsl(h, s, l - 0.34), fo=0.85, sw=1.4, so=1.0)


def feature(capa, nombre, muni, cz, geom, extra=None):
    st = estilo(capa, muni, cz)
    props = {
        "capa": capa,
        "nombre": nombre,
        "municipio": muni,
        "subregion": info_muni[muni]["subregion"],
        "centro_zonal": cz,
    }
    props.update(extra or {})
    props.update({
        "fill": st["fill"], "fill-opacity": st["fo"],
        "stroke": st["stroke"], "stroke-width": st["sw"],
    })
    return {"type": "Feature", "properties": props,
            "geometry": a_geojson(geom, sin_simplificar=(capa == "Municipio"))}


# ------------------------------------------------------- UDS por vereda / corr.
cz_por_vereda = collections.defaultdict(collections.Counter)
cz_por_corr = collections.defaultdict(collections.Counter)
for uid, a in V["uds"].items():
    cz = cz_de_uds.get(uid)
    if cz is None or punto_uds[uid]["mun"] != MUNIS[V["veredas"][a[0]]["m"]]:
        continue  # (85 UDS caen en un municipio distinto al que declaran: coordenada mal capturada)
    cz_por_vereda[a[0]][cz] += 1
    if len(a) > 1:
        cz_por_corr[a[1]][cz] += 1

# ---------------------------------------------------------- geometria veredas
ver_geom = {}
for i, ve in enumerate(V["veredas"]):
    g = geom_desde_codificada(ve["g"])
    if g is not None:
        ver_geom[i] = g
cor_geom = {}
for i, co in enumerate(V["corregimientos"]):
    g = geom_desde_codificada(co["g"])
    if g is not None:
        cor_geom[i] = g
print("veredas con geometria: %d/%d ; corregimientos: %d/%d"
      % (len(ver_geom), len(V["veredas"]), len(cor_geom), len(V["corregimientos"])))

# ------------------------------------------------------------ Medellin (5 CZ)
MED = "MEDELLIN"
MED_I = MUNIS.index(MED)
uds_med = [(Point(punto_uds[u]["x"], punto_uds[u]["y"]), cz_de_uds[u])
           for u, a in V["uds"].items()
           if V["veredas"][a[0]]["m"] == MED_I and u in cz_de_uds and punto_uds[u]["mun"] == MED]
print("UDS dentro de MEDELLIN:", len(uds_med))


def cz_mas_cercano(geom):
    p = geom.representative_point()
    return min(uds_med, key=lambda t: t[0].distance(p))[1]


def cz_vereda(i):
    ve = V["veredas"][i]
    if MUNIS[ve["m"]] != MED:
        return CZ_MUNI[MUNIS[ve["m"]]]
    c = cz_por_vereda.get(i)
    if c:
        return c.most_common(1)[0][0]
    if ve["cr"] is not None and cz_por_corr.get(ve["cr"]):
        return cz_por_corr[ve["cr"]].most_common(1)[0][0]
    return cz_mas_cercano(ver_geom[i])


def cz_corr(i):
    co = V["corregimientos"][i]
    if MUNIS[co["m"]] != MED:
        return CZ_MUNI[MUNIS[co["m"]]]
    c = cz_por_corr.get(i)
    return c.most_common(1)[0][0] if c else cz_mas_cercano(cor_geom[i])


# ---------------------------------------------- matices por adyacencia de CZ
import random


def asignar_matices():
    """18 matices a 20 deg de distancia. Se busca la permutacion que maximiza la
    distancia de matiz minima entre CZ vecinos (los que comparten frontera)."""
    geo_cz = collections.defaultdict(list)
    for m in C["municipios"]:
        if m["nombre"] != MED:
            geo_cz[CZ_MUNI[m["nombre"]]].append(
                Polygon([(lon, lat) for lat, lon in m["poligono"][0]]).buffer(0))
    med = unary_union([ver_geom[i] for i, ve in enumerate(V["veredas"])
                       if ve["m"] == MED_I and i in ver_geom])
    cz_med = {cz for _, cz in uds_med}
    union = {cz: unary_union(gs).buffer(0.003) for cz, gs in geo_cz.items()}
    vecinos = collections.defaultdict(set)
    for a in union:
        for b in union:
            if a < b and union[a].intersects(union[b]):
                vecinos[a].add(b)
                vecinos[b].add(a)
        if a not in cz_med and union[a].intersects(med.buffer(0.003)):
            for b in cz_med:
                vecinos[a].add(b)
                vecinos[b].add(a)
    for a in cz_med:
        for b in cz_med:
            if a != b:
                vecinos[a].add(b)
    lista = CZS
    n = len(lista)

    def dist(h1, h2):
        d = abs(h1 - h2) % 360
        return min(d, 360 - d)

    def costo(perm):  # menor = mejor: penaliza vecinos con matices cercanos
        hue = {cz: perm[i] * (360 / n) for i, cz in enumerate(lista)}
        return sum(1.0 / (dist(hue[a], hue[b]) ** 2) for a in lista for b in vecinos[a] if a < b)

    rnd = random.Random(7)
    mejor = list(range(n))
    rnd.shuffle(mejor)
    mejor_c = costo(mejor)
    for _ in range(40000):
        cand = mejor[:]
        i, j = rnd.sample(range(n), 2)
        cand[i], cand[j] = cand[j], cand[i]
        c = costo(cand)
        if c <= mejor_c:
            mejor, mejor_c = cand, c
    for i, cz in enumerate(lista):
        HUE_CZ[cz] = mejor[i] * (360 / n)
    peor = min(dist(HUE_CZ[a], HUE_CZ[b]) for a in lista for b in vecinos[a])
    print("matiz minimo entre CZ vecinos: %.0f deg" % peor)


asignar_matices()


# casco urbano de Medellin: Voronoi de las UDS por CZ, recortado a la cabecera
def partir_cabecera_medellin(cab):
    """-> [(cz, geom)] ; poligonos de proximidad, recortados a la cabecera."""
    puntos = [p for p, _ in uds_med]
    x0, y0, x1, y1 = cab.bounds
    m = 0.05
    caja = Polygon([(x0 - m, y0 - m), (x1 + m, y0 - m), (x1 + m, y1 + m), (x0 - m, y1 + m)])
    from shapely.geometry import MultiPoint
    celdas = voronoi_diagram(MultiPoint(puntos), envelope=caja)
    por_cz = collections.defaultdict(list)
    for celda in celdas.geoms:
        for p, cz in uds_med:
            if celda.contains(p):
                por_cz[cz].append(celda)
                break
    piezas = []
    for cz, celdas_cz in por_cz.items():
        g = solo_poligonos(unary_union(celdas_cz).intersection(cab))
        if g is not None and not g.is_empty:
            piezas.append((cz, g))
    return piezas


# ------------------------------------------------------------------ capas
capas = {"municipios": [], "corregimientos": [], "veredas": [], "cabeceras": []}
piezas_municipio_med = collections.defaultdict(list)  # cz -> geoms (Medellin)

# Veredas y cabeceras
n_cab = n_ver = 0
for i, ve in enumerate(V["veredas"]):
    g = ver_geom.get(i)
    if g is None:
        continue
    muni = MUNIS[ve["m"]]
    corr = None
    if ve["cr"] is not None and V["corregimientos"][ve["cr"]]["n"] != "Cabecera":
        corr = V["corregimientos"][ve["cr"]]["n"]
    es_cab = ve["t"] == "CM"
    cz = cz_vereda(i)
    extra = {"codigo": ve["cod"], "corregimiento": corr}
    if muni == MED:
        piezas_municipio_med[cz].append(g)
    if es_cab:
        n_cab += 1
        if muni == MED:
            for cz2, g2 in partir_cabecera_medellin(g):
                capas["cabeceras"].append(feature(
                    "Cabecera", "Cabecera " + muni.title(), muni, cz2, g2,
                    {"codigo": ve["cod"], "aprox_cz": True}))
                piezas_municipio_med[cz2].append(g2)
            # la cabecera ya se repartio entre CZ: no cuenta entera para el municipio
            piezas_municipio_med[cz].remove(g)
        else:
            capas["cabeceras"].append(feature("Cabecera", "Cabecera " + muni.title(), muni, cz, g, extra))
    else:
        n_ver += 1
        capas["veredas"].append(feature("Vereda", ve["n"], muni, cz, g, extra))

# Corregimientos reales (sin el pseudo-corregimiento "Cabecera")
for i, co in enumerate(V["corregimientos"]):
    if co["n"] == "Cabecera" or i not in cor_geom:
        continue
    muni = MUNIS[co["m"]]
    capas["corregimientos"].append(feature(
        "Corregimiento", co["n"], muni, cz_corr(i), cor_geom[i],
        {"veredas": co["nv"]}))

# Municipios
for m in C["municipios"]:
    nombre = m["nombre"]
    if nombre == MED:
        for cz, gs in sorted(piezas_municipio_med.items()):
            g = solo_poligonos(unary_union(gs).buffer(0.0002).buffer(-0.0002))
            if g is not None:
                capas["municipios"].append(feature(
                    "Municipio", nombre, nombre, cz, g, {"aprox_cz": True}))
        continue
    anillo = [(lon, lat) for lat, lon in m["poligono"][0]]
    g = Polygon(anillo)
    if not g.is_valid:
        g = solo_poligonos(g.buffer(0))
    capas["municipios"].append(feature("Municipio", nombre, nombre, CZ_MUNI[nombre], g,
                                       {}))

print("municipios(poligonos):", len(capas["municipios"]), "| corregimientos:",
      len(capas["corregimientos"]), "| veredas:", n_ver, "| cabeceras(poligonos):",
      len(capas["cabeceras"]))

# ---------------------------------------------------------------- escritura
os.makedirs(OUT_DIR, exist_ok=True)


def escribir(nombre, features):
    fc = {"type": "FeatureCollection", "name": nombre, "features": features}
    ruta = os.path.join(OUT_DIR, nombre + ".geojson")
    with io.open(ruta, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))
    print("%-34s %6d figuras  %7.2f MB" % (nombre + ".geojson", len(features),
                                           os.path.getsize(ruta) / 1048576.0))


for k, fs in capas.items():
    escribir("antioquia_" + k, fs)
todo = capas["municipios"] + capas["corregimientos"] + capas["veredas"] + capas["cabeceras"]
escribir("antioquia_completo", todo)

# leyenda CZ -> color (para consulta; no es parte de la capa)
leyenda = [{"centro_zonal": cz, "color_base": hsl(HUE_CZ[cz], 0.62, 0.50)} for cz in CZS]
with io.open(os.path.join(OUT_DIR, "leyenda_centros_zonales.json"), "w", encoding="utf-8") as f:
    json.dump(leyenda, f, ensure_ascii=False, indent=1)
