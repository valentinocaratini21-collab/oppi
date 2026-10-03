#!/usr/bin/env python3
"""Oppi web — build del archivo único para compartir.

Genera un solo .html autocontenido desde el código fuente estructurado
(`oppi-web/index.html` + `css/` + `js/`). El orden de los scripts se lee
del propio index.html, así nunca se desactualiza.

Uso:
    python3 scripts/build-single-file.py [salida.html]

El archivo generado lleva un header "GENERATED — DO NOT EDIT".
Para cambiar la app, editar el fuente en oppi-web/ y regenerar.
Los tags CDN (Leaflet) se preservan: el mapa necesita internet.
"""
import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent.parent / "oppi-web"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("oppi-un-solo-archivo.html")

HEADER = """<!--
  ═══════════════════════════════════════════════════════════════
  ARCHIVO GENERADO — NO EDITAR A MANO
  Generado con: python3 scripts/build-single-file.py
  Código fuente estructurado en: oppi-web/
    index.html          → este HTML
    css/styles.css      → estilos
    js/*.js             → 17 módulos (api, router, vistas, app)
  Para cambiar la app: editá el fuente y regenerá este archivo.
  ═══════════════════════════════════════════════════════════════
-->
"""

def main():
    html = (WEB / "index.html").read_text(encoding="utf-8")

    # 1) CSS inline
    css = (WEB / "css" / "styles.css").read_text(encoding="utf-8")
    tag = '<link rel="stylesheet" href="css/styles.css">'
    assert tag in html, "no se encontró el link al CSS en index.html"
    html = html.replace(tag, "<style>\n" + css + "\n</style>")

    # 2) JS inline, en el orden del index.html
    scripts = re.findall(r'<script src="(js/[^"]+)"></script>', html)
    assert scripts, "no se encontraron scripts locales en index.html"
    for src in scripts:
        js = (WEB / src).read_text(encoding="utf-8")
        assert "</script" not in js, f"{src} contiene '</script' — rompería el inline"
        html = html.replace(
            f'<script src="{src}"></script>',
            "<script>\n" + js + "\n</script>",
        )

    # 3) Verificación: no quedan referencias locales
    assert 'src="js/' not in html, "quedaron scripts locales sin inlinear"
    assert 'href="css/' not in html, "quedó CSS local sin inlinear"

    OUT.write_text(HEADER + html, encoding="utf-8")
    print(f"OK: {OUT} ({OUT.stat().st_size} bytes, {len(scripts)} scripts inline)")

if __name__ == "__main__":
    main()
