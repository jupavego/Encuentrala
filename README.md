# Encuentrala

**¿Dónde lo ubico?** — sitio estático que ubica la Unidad de Servicio (UDS) del ICBF más cercana a cualquier punto de los 125 municipios de Antioquia.

Radio de búsqueda adaptativo, filtros de municipio / corregimiento / vereda, búsqueda de dirección (texto libre o por partes) vía Nominatim/OpenStreetMap, y ubicación manual arrastrando el pin o escribiendo coordenadas.

## Contenido

- `DONDE LO UBICO - Cercania UDS Antioquia.html` — el sitio, listo para abrir en cualquier navegador (no requiere servidor ni build).
- `codigo/` — pipeline de generación:
  - `generar_datos_cercania.py` — procesa la base de cobertura y arma `recursos/datos_cercania.json`.
  - `generar_datos_veredas.py` — cruza esas UDS con el mapa veredal y arma `recursos/datos_veredas.json`.
  - `generar_sitio.py` — arma el HTML final a partir de `codigo/plantilla/` + los dos JSON.
  - `plantilla/` — plantilla HTML/CSS (`tpl_head.html`) y lógica JS (`tpl_tail.js`).
  - `favicon_b64.txt` — ícono de la pestaña (y del pin del mapa), en base64.
- `recursos/datos_cercania.json` — UDS, municipios y coordenadas ya procesados.
- `recursos/datos_veredas.json` — contornos de veredas/corregimientos y a qué vereda pertenece cada UDS.

## Cómo reconstruir el sitio

```
python codigo/generar_datos_cercania.py    # solo si cambió el Excel fuente
python codigo/generar_datos_veredas.py     # solo si cambió lo anterior o el mapa veredal
python codigo/generar_sitio.py
```

El orden importa: los dos JSON se cruzan por Código UDS, así que si se regenera
`datos_cercania.json` hay que volver a correr `generar_datos_veredas.py` antes de
armar el sitio. `generar_sitio.py` verifica esa correspondencia y se detiene con un
mensaje si están desfasados.

`generar_datos_veredas.py` requiere **shapely** (`pip install shapely`), solo en
tiempo de construcción — el sitio final no depende de nada externo salvo Leaflet,
los tiles de OpenStreetMap y Nominatim.

## Si el script se detiene diciendo que la hoja no pasó las comprobaciones

`generar_datos_cercania.py` revisa la hoja `CUENTAME` antes de escribir nada:

1. **`Estado de la UDS` tiene que ser categórica** (un puñado de valores distintos).
2. **`Latitud UDS` tiene que traer coordenadas** en grados/minutos/segundos (≥90% de
   las filas con valor).
3. **No puede caer más del 10%** el número de UDS ni de municipios respecto a la
   última corrida buena (comparado contra el `recursos/datos_cercania.json` del repo).

Si alguna falla, el script aborta **sin escribir ningún archivo** y el sitio publicado
se queda con los últimos datos buenos.

La causa casi siempre es la misma: **la hoja se volvió a guardar con las columnas
corridas respecto a su fila de encabezado** (pasa al pegar un export nuevo que trae
otro orden de columnas, o al insertar/borrar columnas en una parte de la hoja). Pasó
el 28-08-2026: el `.xlsm` quedó corrido y el script —que entonces no validaba nada—
leyó 343 UDS en 10 municipios en vez de 4.328 en 125, sin avisar.

**Qué hacer:** recuperar una copia sana del `.xlsm` (historial de versiones de
OneDrive, o la copia que haya quedado en la carpeta de otra reunión) y volver a
correr. Si el cambio es intencional y esperado, `--forzar` salta las comprobaciones:

```
python codigo/generar_datos_cercania.py --forzar
```

Conviene revisar el `.xlsm` antes de guardarlo: que la primera fila de datos siga
alineada con su encabezado, sobre todo después de pegar un export nuevo.

## Fuentes de datos

- **Unidades de Servicio ICBF activas** — BD ANALISIS COBERTURA (Cuéntame), Regional Antioquia.
- **Contornos municipales** — `antioquia_con_comunas v5.geojson`.
- **Veredas y corregimientos** — Mapa Veredal Digital de Antioquia, Departamento
  Administrativo de Planeación de la Gobernación de Antioquia (capa pública
  `Veredas_Antioquia` en ArcGIS). 5.084 polígonos veredales agrupados en 403
  corregimientos. Descarga:
  `https://services5.arcgis.com/K90UQIB09TmTjUL8/arcgis/rest/services/Veredas_Antioquia/FeatureServer/0`

Ver la sección "Fuentes y metodología" dentro del propio sitio para el detalle completo.

## Nota sobre precisión

La vereda que se le atribuye a cada UDS se calcula contra los polígonos a **precisión
completa** (3,2 millones de vértices). Lo que se dibuja en pantalla sí va simplificado
(~22 m) y con coordenadas de 4 decimales (~11 m), para que la página cargue liviana.
Consecuencia esperada: una UDS a menos de ~25 m del límite de su vereda puede *verse*
del lado de afuera del contorno dibujado, aunque su clasificación sea la correcta.
