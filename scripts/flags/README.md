# Banderas — pipeline iOS (CoreSVG)

Las tres plataformas usan el mismo set: **lipis/flag-icons v7.2.3, formato 4x3** (270 códigos).

| Plataforma | Dónde viven | Motor de render |
|---|---|---|
| Web | CDN jsdelivr (`js/shared.js` → `countryFlag()`) | navegador (SVG completo) |
| Android | `android-app/app/src/main/assets/flags/*.svg` (byte-idéntico al canónico) | Coil + AndroidSVG (completo) |
| iOS | `Assets.xcassets/Flags/<code>.imageset/<code>.svg` (`preserves-vector-representation`) | **CoreSVG (parcial — ver bugs)** |

**Regla:** web y Android llevan SIEMPRE el SVG canónico sin tocar. Los SVG de
iOS son los únicos que se normalizan, porque CoreSVG no es un renderer completo.
Al actualizar el set (nueva versión de flag-icons), copiar los canónicos a iOS
y pasar el pipeline completo de abajo.

## Bugs de CoreSVG conocidos (auditoría 2026-06-10, las 270 banderas)

1. **`<use xlink:href>`** — la geometría instanciada colapsa/duplica.
   Cazado en la bandera de Camerún (build 1059): las 62 banderas afectadas se
   aplanaron (cada `<use>` expandido a copia real). Commit `d2fa0716c47`.
2. **`clip-path` en espacio de usuario + `transform` en el MISMO elemento**
   (patrón legacy de flag-icons; el rect del clip × transform == viewBox).
   CoreSVG dimensiona/recorta mal: Tanzania salía a 1/3, Aruba a 1/2, Libia a
   3/4, bandas blancas en bordes en ~45 banderas más. Fix: transformar el clip
   a espacio raíz y anidar el transform en un `<g>` interior (60 banderas).
3. **`<marker>`/`marker-mid` no soportado** — us/um pintan las 50 estrellas con
   markers: en iOS desaparecían. Fix: expandir cada estampa en un
   `<path transform="translate(x y)">` verbatim. ⚠ cairosvg coloca los markers
   ~1px abajo-derecha de donde los colocan los navegadores; la referencia
   válida para us/um es el navegador (canvas de Chrome: 0.003% de diff).
4. **Paint servers colgantes** — `fill="url(#id)"` sin definición (sh-ac: el
   build upstream de flag-icons perdió los 96 gradientes del escudo). La spec
   (web/Android) lo trata como `none`; CoreSVG lo pinta. Fix: `fill="none"`
   explícito = fidelidad con lo que muestra la web.
5. **Trazos bajo escala anisótropa** — es-ct (franjas como stroke-width 60 ×
   `scale(.79012 .88889)`): CoreSVG desplaza los bordes ~1px. Fix: franjas
   horizontales → rects equivalentes. gb-sct (diagonales) renderiza PERFECTO
   en CoreSVG → no tocar (el fixer lo excluye a propósito).

**Residuo aceptado** (sub-visible a 20×15 pt, documentado y verificado):
`pf` ~0.5% y `kh` ~0.2% (AA de trazos finos en emblemas). `gu` (texto `<text>`)
y los gradientes con herencia `href` (bz/fk/gt/gs/mx/ni) renderizan bien.

## Pipeline (al tocar cualquier SVG de iOS o actualizar el set)

```bash
# 0) preparar entorno una vez
brew install cairo
mkdir -p /tmp/flag-audit && cd /tmp/flag-audit
python3 -m venv venv && venv/bin/pip install cairosvg pillow numpy
curl -sL https://github.com/lipis/flag-icons/archive/refs/tags/v7.2.3.tar.gz | tar xz

# 1) normalizar (idempotente)
python3 scripts/flags/normalize-ios-flags.py            # --dry-run para ver

# 2) puerta 1 — equivalencia de contenido (renderer completo)
DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib \
  /tmp/flag-audit/venv/bin/python scripts/flags/verify-flags-render.py gate1

# 3) puerta 2 — el motor REAL de iOS (CoreSVG en simulador)
ls ios-app/CalendarioCiclismo/Assets.xcassets/Flags/ | sed 's/\.imageset$//' \
  | grep -v Contents.json | python3 -c "import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))" \
  > /tmp/flag-audit/names.json
mkdir -p /tmp/flag-audit/ios
cd ios-app && xcodebuild -project CalendarioCiclismo.xcodeproj -scheme CalendarioCiclismo \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -only-testing:CalendarioCiclismoTests/FlagRenderAuditTests test && cd ..
DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib \
  /tmp/flag-audit/venv/bin/python scripts/flags/verify-flags-render.py gate2
```

El test `FlagRenderAuditTests` solo corre si existe `/tmp/flag-audit/names.json`
(en CI se salta solo). Vuelca el render CoreSVG de cada bandera a
`/tmp/flag-audit/ios/<code>.png` a 480×360.
