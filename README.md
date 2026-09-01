# Encuentrala

**¿Dónde lo ubico?** — sitio estático que ubica la Unidad de Servicio (UDS) del ICBF más cercana a cualquier punto de los 125 municipios de Antioquia.

Radio de búsqueda adaptativo, filtros de municipio / corregimiento / vereda, búsqueda de dirección (texto libre o por partes) vía Nominatim/OpenStreetMap, y ubicación manual arrastrando el pin o escribiendo coordenadas.

## Contenido

- `DONDE LO UBICO - Cercania UDS Antioquia.html` — el sitio, listo para abrir en cualquier navegador (no requiere servidor ni build).
- `codigo/` — pipeline de generación:
  - `generar_datos_cercania.py` — procesa la base de cobertura y arma `recursos/datos_cercania.json`.
  - `generar_datos_veredas.py` — cruza esas UDS con el mapa veredal y arma `recursos/datos_veredas.json`.
  - `generar_datos_cuentame.py` — extrae la hoja CUENTAME completa para la descarga a Excel (**ver la advertencia sobre datos personales**).
  - `generar_sitio.py` — arma el HTML final a partir de `codigo/plantilla/` + los tres JSON.
  - `verificar.py` — pruebas de humo sobre los datos publicados.
  - `verificar_xlsx.py` — comprueba que el Excel que genera el sitio se abra de verdad (requiere Node).
  - `auditar_personales.py` — comprueba que el HTML publicado no exponga datos de identidad.
  - `plantilla/` — plantilla HTML/CSS (`tpl_head.html`) y lógica JS (`tpl_tail.js`).
  - `favicon_b64.txt` — ícono de la pestaña (y del pin del mapa), en base64.
- `recursos/datos_cercania.json` — UDS, municipios y coordenadas ya procesados.
- `recursos/datos_veredas.json` — contornos de veredas/corregimientos y a qué vereda pertenece cada UDS.
- `recursos/datos_cuentame.json` — la hoja CUENTAME completa, para la descarga a Excel.

## Cómo reconstruir el sitio

```
python codigo/generar_datos_cercania.py    # solo si cambió el Excel fuente
python codigo/generar_datos_veredas.py     # solo si cambió lo anterior o el mapa veredal
python codigo/generar_datos_cuentame.py    # solo si cambió el Excel fuente
python codigo/generar_sitio.py
python codigo/verificar.py                 # comprueba los datos publicados
python codigo/verificar_xlsx.py            # comprueba la descarga a Excel (requiere Node)
python codigo/auditar_personales.py        # OBLIGATORIO antes de publicar
```

El orden importa: los tres JSON se cruzan por Código UDS, así que si se regenera
`datos_cercania.json` hay que volver a correr los otros dos antes de armar el sitio.
`generar_sitio.py` verifica esa correspondencia y se detiene con un mensaje si están
desfasados.

`generar_datos_veredas.py` requiere **shapely** (`pip install shapely`), solo en
tiempo de construcción — el sitio final no depende de nada externo salvo Leaflet,
los tiles de OpenStreetMap y Nominatim.

## Descarga a Excel

A la derecha del título **Resultados** hay un botón **Descargar Excel** que entrega
un `.xlsx` con la hoja `CUENTAME` original, acotada a las UDS que esa sección
muestra: todas las del radio de búsqueda, las tres bandas de distancia juntas.

Además de las columnas de CUENTAME, el archivo trae dos propias al final:

- `Corregimiento (mapa veredal Antioquia)`
- `Vereda (mapa veredal Antioquia)`

Son la zona que **este sitio** le atribuye a cada UDS cruzando su coordenada contra
el mapa veredal. Van rotuladas aparte a propósito: no salen del reporte Cuéntame, y
CUENTAME ya trae un `Centro Poblado UDS` que es otra cosa y no siempre coincide.

El archivo se arma en el navegador, sin librerías externas (un `.xlsx` es un ZIP con
unos XML dentro). `codigo/verificar_xlsx.py` comprueba de punta a punta que lo que
produce el sitio se abra en un lector de Excel real y que el contenido sea exacto.

## ⚠ Datos personales

El sitio se publica en **https://encuentrala.vercel.app/ , una URL de acceso
abierto**. Por eso `codigo/generar_datos_cuentame.py` va con:

```python
INCLUIR_DATOS_PERSONALES = False
```

Con eso, las cinco columnas de identidad del responsable de cada UDS **no se
embeben en el HTML**:

`Identificación Responsable UDS`, `Primer Nombre`, `Segundo Nombre`,
`Primer Apellido`, `Segundo Apellido`.

El Excel descargado queda con 53 columnas (51 de CUENTAME + 2 de zona) en vez de
58. No se pierde ninguna UDS: las 4.328 filas siguen completas, y también
contrato, entidad, ubicación, cupos, servicio, vivienda, fechas y clasificación
de cobertura.

### Antes de cada publicación

```
python codigo/auditar_personales.py
```

Compara el HTML generado contra la hoja fuente y falla si alguna columna de
identidad quedó declarada, o si un documento o un nombre aparece como valor de
un campo publicado. Compara **campo por campo**, no por subcadena: buscar
`43272222` como texto suelto da positivos falsos, porque esos dígitos aparecen
dentro de la coordenada `-75.54327222222221`.

La auditoría reporta dos avisos esperados, que **no** son fugas:

- Unos 35 nombres y apellidos coinciden con topónimos que el sitio ya publicaba:
  `AMALFI`, `BARBOSA`, `BELLO` son municipios; `BELEN` un barrio; `LAGUNA` y
  `GALAN` nombres de veredas. La auditoría muestra de qué columna sale cada uno.
- La UDS `058471148728` trae un número de documento digitado por error en
  `Teléfono UDS`. Es un error de captura en la fuente, en una columna que ya era
  pública desde antes.

### Si alguna vez hay que volver a incluirlos

Poner `INCLUIR_DATOS_PERSONALES = True` y volver a correr ese script y
`generar_sitio.py`. En ese caso el sitio **no puede quedar en una URL abierta**:
hay que ponerle control de acceso primero (en Vercel, *Deployment Protection* →
*Password Protection* o *Vercel Authentication*). `generar_sitio.py` avisa en
cada corrida qué versión está armando.

Incluso así, el **número de documento nunca sale completo**: se enmascara siempre
(`****5546`, solo los últimos 4 dígitos). Es irreversible — los dígitos ocultos no
están en ninguna parte del archivo publicado.

> **Por qué enmascarar y no cifrar.** El sitio es una página estática. Cualquier
> llave capaz de descifrar el dato tendría que viajar dentro de la misma página, al
> alcance de quien la abra: un cifrado así no protegería nada, solo lo aparentaría.

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
