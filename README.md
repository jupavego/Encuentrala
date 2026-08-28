# Encuentrala

**¿Dónde lo ubico?** — sitio estático que ubica la Unidad de Servicio (UDS) del ICBF más cercana a cualquier punto de los 125 municipios de Antioquia.

Radio de búsqueda adaptativo, selección de municipio, búsqueda de dirección (texto libre o por partes) vía Nominatim/OpenStreetMap, y ubicación manual arrastrando el pin o escribiendo coordenadas.

## Contenido

- `DONDE LO UBICO - Cercania UDS Antioquia.html` — el sitio, listo para abrir en cualquier navegador (no requiere servidor ni build).
- `codigo/` — pipeline de generación:
  - `generar_datos_cercania.py` — procesa la base de cobertura y arma `recursos/datos_cercania.json`.
  - `generar_sitio.py` — arma el HTML final a partir de `codigo/plantilla/` + los datos.
  - `plantilla/` — plantilla HTML/CSS (`tpl_head.html`) y lógica JS (`tpl_tail.js`).
  - `favicon_b64.txt` — ícono de la pestaña (y del pin del mapa), en base64.
- `recursos/datos_cercania.json` — datos ya procesados (UDS, municipios, coordenadas) que consume `generar_sitio.py`.

## Fuente de datos

Unidades de Servicio ICBF activas — BD ANALISIS COBERTURA (Cuéntame), Regional Antioquia. Contornos municipales desde `antioquia_con_comunas`. Ver la sección "Fuentes y metodología" dentro del propio sitio para el detalle completo.
