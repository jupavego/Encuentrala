# -*- coding: utf-8 -*-
"""
Arma los GeoJSON para la capa de referencia del mapa Azure Maps de Power BI:
municipios, corregimientos, veredas y cabeceras de Antioquia, mas comunas y
barrios de Medellin, coloreados por Centro Zonal ICBF.

Lee solo lo que ya hay en recursos/ (no necesita el geojson crudo de "fuente/"):
  - datos_veredas.json : contornos de veredas y corregimientos + a que vereda
                         cae cada UDS
  - datos_cercania.json: contorno municipal, subregion y Centro Zonal de cada UDS
  - medellin_barrios_comunas_cz.geojson: comunas, corregimientos y barrios de
                         Medellin con su Centro Zonal (archivo entregado por la
                         Regional; version compacta del original)

Salida: powerbi/*.geojson

REGLAS QUE CONVIENE SABER
  * "Cabecera" en el mapa veredal NO es el casco urbano: es el nombre del
    "corregimiento" que agrupa todas las veredas que no pertenecen a un
    corregimiento real (es decir, el resto rural del municipio). Por eso aqui
    NO se dibuja como corregimiento. Las cabeceras de verdad son las 125
    figuras de tipo VERE_TIPO = "CM" (cabecera municipal).
  * Centro Zonal: cada municipio cae en un solo CZ (el que declaran sus UDS),
    salvo MEDELLIN, cuyo CZ viene del archivo de comunas/barrios: CZ Integral
    Nororiental, Integral Noroccidental, Sur Oriente y Rosales. ("BC MEDELLIN"
    aparece en las UDS pero no tiene territorio propio, asi que no se pinta.)
    En Medellin la cabecera es la union de sus 16 comunas, y las veredas y
    corregimientos toman el CZ del poligono de corregimiento donde caen.

Requiere shapely (pip install shapely).
"""
import collections
import colorsys
import io
import json
import os

from shapely.geometry import Polygon, shape
from shapely.geometry.polygon import orient
from shapely import set_precision
from shapely.ops import unary_union

D = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(D)
OUT_DIR = os.path.join(RAIZ, "powerbi")
PRECISION = 4  # igual que el sitio; ~11 m
# Simplificacion extra (grados) de veredas, corregimientos y cabeceras para que
# el archivo completo quepa en lo que el visual de Power BI carga bien (~5 MB).
# 0.001 ~ 110 m: las veredas pequenas conservan su forma, los bordes se alisan.
SIMPLIFICAR = float(os.environ.get("SIMPLIFICAR", "0.001"))
# capas con figuras chicas o bordes muy visibles se simplifican menos (grados)
TOL_CAPA = {"Municipio": 0.0004, "Cabecera": 0.0004, "Comuna": 0.0001, "Barrio": 0.00012}


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


def a_geojson(geom, sin_simplificar=None):
    """Poligono/multipoligono con anillos exteriores antihorarios (RFC 7946) y
    coordenadas a PRECISION decimales."""
    tol = TOL_CAPA.get(sin_simplificar, SIMPLIFICAR) if sin_simplificar else SIMPLIFICAR
    if tol > 0:
        g2 = geom.simplify(tol, preserve_topology=True)
        if not g2.is_valid:
            g2 = solo_poligonos(g2.buffer(0)) or g2
        if not g2.is_empty:
            geom = g2
    # redondear a la malla de PRECISION decimales sin crear auto-intersecciones
    # (set_precision repara lo que el redondeo simple deja invalido)
    geom = solo_poligonos(set_precision(geom, 10 ** -PRECISION)) or geom
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

MED = "MEDELLIN"
MED_I = MUNIS.index(MED)

# ---- Medellin: comunas, corregimientos y barrios con su CZ
with io.open(os.path.join(RAIZ, "recursos", "medellin_barrios_comunas_cz.geojson"), encoding="utf-8") as f:
    MEDF = json.load(f)


def nz(s):
    return s.upper().replace("Á", "A").replace("É", "E").replace("Í", "I").replace("Ó", "O").replace("Ú", "U")


def valida(g):
    return solo_poligonos(g if g.is_valid else g.buffer(0))


med_comunas, med_corr_poly, med_barrios = [], [], []
for ft in MEDF["features"]:
    pr = ft["properties"]
    g = valida(shape(ft["geometry"]))
    item = (pr["name"], nz(pr["centro_zonal"]), g, pr.get("comuna"))
    if pr.get("comuna") is not None:
        med_barrios.append(item)
    elif int(pr["name"].split()[0]) <= 16:
        med_comunas.append(item)
    else:
        med_corr_poly.append(item)
MED_CZS = sorted({x[1] for x in med_comunas + med_corr_poly})
print("Medellin: %d comunas, %d corregimientos, %d barrios; CZ: %s"
      % (len(med_comunas), len(med_corr_poly), len(med_barrios), MED_CZS))

# ---- paleta: un matiz por CZ (se asigna mas abajo, cuando ya hay geometrias,
# para que los CZ que se tocan queden con matices lejanos entre si)
CZS = sorted({CZ_MUNI[m] for m in MUNIS if m != MED} | set(MED_CZS))
HUE_CZ = {}
UNIDADES_CZ = collections.defaultdict(list)  # cz -> claves de color de sus municipios/comunas
for m in MUNIS:
    if m != MED:
        UNIDADES_CZ[CZ_MUNI[m]].append(m)
for n, cz, g, _ in med_comunas + med_corr_poly:
    UNIDADES_CZ[cz].append("MED " + n)
for cz in UNIDADES_CZ:
    UNIDADES_CZ[cz].sort()


def tono(clave, cz):
    """(matiz, saturacion, luminosidad) de una unidad (municipio, o comuna /
    corregimiento de Medellin) dentro de su CZ: misma familia de matiz, pero
    cada unidad unos puntos distinta."""
    hermanos = UNIDADES_CZ[cz]
    j = hermanos.index(clave) if clave in hermanos else 0
    n = max(len(hermanos), 1)
    # orden entrelazado (0, n/2, 1, n/2+1 ...) para que vecinos alfabeticos no queden identicos
    orden = (j // 2) + (n + 1) // 2 * (j % 2)
    t = (orden / max(n - 1, 1)) - 0.5          # -0.5 .. 0.5
    return (HUE_CZ[cz] + 10 * t, 0.62 - 0.10 * abs(t), 0.50 + 0.16 * t)


def estilo(capa, clave, cz):
    h, s, l = tono(clave, cz)
    if capa == "Municipio":
        return dict(fill=hsl(h, s, l + 0.08), stroke=hsl(h, s, l - 0.28), fo=0.45, sw=1.6)
    if capa == "Corregimiento":
        return dict(fill=hsl(h, s, l), stroke=hsl(h, s, l - 0.22), fo=0.55, sw=1.0)
    if capa == "Comuna":
        return dict(fill=hsl(h, s, l), stroke=hsl(h, s, l - 0.24), fo=0.60, sw=1.2)
    if capa == "Vereda":
        return dict(fill=hsl(h, s, l + 0.10), stroke=hsl(h, s, l - 0.18), fo=0.50, sw=0.6)
    if capa == "Barrio":
        return dict(fill=hsl(h, s, l + 0.10), stroke=hsl(h, s, l - 0.18), fo=0.60, sw=0.5)
    return dict(fill=hsl(h, s, l - 0.14), stroke=hsl(h, s, l - 0.34), fo=0.85, sw=1.4)


def feature(capa, nombre, muni, cz, geom, extra=None, clave=None):
    st = estilo(capa, clave or muni, cz)
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
            "geometry": a_geojson(geom, sin_simplificar=(capa if capa in TOL_CAPA else None))}


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

# --------------------------------------- CZ y clave de color de Medellin por posicion
med_unidades = med_corr_poly + med_comunas  # corregimientos primero (el casco urbano es la suma de comunas)


def unidad_med(geom):
    """(nombre, cz) de la comuna/corregimiento de Medellin donde cae la figura;
    si el punto interior no cae en ninguno, el de mayor traslape o el mas cercano."""
    p = geom.representative_point()
    for n, cz, g, _ in med_unidades:
        if g.contains(p):
            return n, cz
    mejor = max(med_unidades, key=lambda u: u[2].intersection(geom).area)
    if mejor[2].intersection(geom).area > 0:
        return mejor[0], mejor[1]
    mejor = min(med_unidades, key=lambda u: u[2].distance(p))
    return mejor[0], mejor[1]


def cz_y_clave(muni, geom):
    if muni != MED:
        return CZ_MUNI[muni], muni
    n, cz = unidad_med(geom)
    return cz, "MED " + n


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
    for n, cz, g, _ in med_unidades:
        geo_cz[cz].append(g)
    cz_med = set(MED_CZS)
    med = unary_union([g for _, _, g, _ in med_unidades]).buffer(0.003)
    union = {cz: unary_union(gs).buffer(0.003) for cz, gs in geo_cz.items()}
    vecinos = collections.defaultdict(set)
    for a in union:
        for b in union:
            if a < b and union[a].intersects(union[b]):
                vecinos[a].add(b)
                vecinos[b].add(a)
        if a not in cz_med and union[a].intersects(med):
            for b in cz_med:
                vecinos[a].add(b)
                vecinos[b].add(a)
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

# ------------------------------------------------------------------ capas
capas = {"municipios": [], "corregimientos": [], "comunas": [], "veredas": [],
         "barrios": [], "cabeceras": []}
municipio_med = collections.defaultdict(list)  # cz -> geoms (Medellin)

# Veredas (las cabeceras "CM" van aparte; la de Medellin se arma con las comunas)
n_ver = 0
for i, ve in enumerate(V["veredas"]):
    g = ver_geom.get(i)
    if g is None:
        continue
    muni = MUNIS[ve["m"]]
    corr = None
    if ve["cr"] is not None and V["corregimientos"][ve["cr"]]["n"] != "Cabecera":
        corr = V["corregimientos"][ve["cr"]]["n"]
    if ve["t"] == "CM":
        if muni != MED:
            capas["cabeceras"].append(feature("Cabecera", "Cabecera " + muni.title(), muni,
                                              CZ_MUNI[muni], g, {"codigo": ve["cod"]}))
        continue
    cz, clave = cz_y_clave(muni, g)
    n_ver += 1
    capas["veredas"].append(feature("Vereda", ve["n"], muni, cz, g,
                                    {"codigo": ve["cod"], "corregimiento": corr}, clave))

# Corregimientos reales (sin el pseudo-corregimiento "Cabecera")
for i, co in enumerate(V["corregimientos"]):
    if co["n"] == "Cabecera" or i not in cor_geom:
        continue
    muni = MUNIS[co["m"]]
    cz, clave = cz_y_clave(muni, cor_geom[i])
    capas["corregimientos"].append(feature("Corregimiento", co["n"], muni, cz, cor_geom[i],
                                           {"veredas": co["nv"]}, clave))

# Medellin: comunas, barrios, cabecera (union de comunas por CZ)
for n, cz, g, _ in med_comunas:
    capas["comunas"].append(feature("Comuna", n, MED, cz, g, {}, "MED " + n))
    municipio_med[cz].append(g)
for n, cz, g, comuna in med_barrios:
    clave = "MED " + (comuna if comuna else n)
    capas["barrios"].append(feature("Barrio", n, MED, cz, g, {"comuna": comuna}, clave))
for n, cz, g, _ in med_corr_poly:
    municipio_med[cz].append(g)
por_cz = collections.defaultdict(list)
for n, cz, g, _ in med_comunas:
    por_cz[cz].append(g)
for cz, gs in sorted(por_cz.items()):
    u = solo_poligonos(unary_union(gs).buffer(0.0001).buffer(-0.0001))
    capas["cabeceras"].append(feature("Cabecera", "Cabecera Medellin", MED, cz, u, {}, "MED " + cz))

# Municipios
for m in C["municipios"]:
    nombre = m["nombre"]
    if nombre == MED:
        for cz, gs in sorted(municipio_med.items()):
            g = solo_poligonos(unary_union(gs).buffer(0.0002).buffer(-0.0002))
            capas["municipios"].append(feature("Municipio", nombre, nombre, cz, g, {}, "MED " + cz))
        continue
    g = valida(Polygon([(lon, lat) for lat, lon in m["poligono"][0]]))
    capas["municipios"].append(feature("Municipio", nombre, nombre, CZ_MUNI[nombre], g, {}))

print({k: len(v) for k, v in capas.items()})

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
# orden de dibujo: de la capa mas grande a la mas fina
ORDEN = ["municipios", "corregimientos", "veredas", "cabeceras", "comunas", "barrios"]
escribir("antioquia_completo", [x for k in ORDEN for x in capas[k]])

# leyenda CZ -> color (para consulta; no es parte de la capa)
leyenda = [{"centro_zonal": cz, "color_base": hsl(HUE_CZ[cz], 0.62, 0.50)} for cz in CZS]
with io.open(os.path.join(OUT_DIR, "leyenda_centros_zonales.json"), "w", encoding="utf-8") as f:
    json.dump(leyenda, f, ensure_ascii=False, indent=1)
