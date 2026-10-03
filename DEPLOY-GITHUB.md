# Deploy de Oppi a GitHub (y Railway)

Repo: **https://github.com/valentinocaratini21-collab/oppi** (público, rama `main`).

Regla de oro — **pushear a `main` = deploy** (igual que Posta): Railway solo
redeploya cuando hay push a `main`. Commits a otras ramas no deployan nada.

## Subir cambios (un solo commit, vía Git Data API)

El código vive en tres carpetas locales que se mapean así al repo:

| Local | En el repo |
|---|---|
| `~/workspace/oppi/oppi-api/...` | `oppi-api/...` |
| `~/workspace/oppi-web/...` | `oppi-web/...` |
| `~/workspace/oppi/oppi-mobile/...` | `oppi-mobile/...` |
| `~/workspace/oppi/README.md`, `~/workspace/oppi/DEPLOY-GITHUB.md` | raíz del repo |

Comando (UN solo commit con todo lo cambiado, pares `local:repo/path`):

```bash
python3 ~/workspace/skills/github/bin/gh-push.py valentinocaratini21-collab oppi \
  "mensaje del cambio" \
  /home/hatch/workspace/oppi/oppi-api/server.js:oppi-api/server.js \
  /home/hatch/workspace/oppi-web/index.html:oppi-web/index.html \
  ...
```

> Tip: generá la lista de pares con `find` en vez de escribirlos a mano:
>
> ```bash
> cd ~/workspace
> PAIRS=""
> for f in $(find oppi/oppi-api oppi-web oppi/oppi-mobile \
>   -path '*/node_modules/*' -prune -o -path '*/data/*' -prune -o \
>   -name '.env' -prune -o -type f -print); do
>   r="${f#oppi/oppi-api/}";  [ "$r" != "$f" ] && PAIRS="$PAIRS $f:oppi-api/$r" && continue
>   r="${f#oppi/oppi-mobile/}"; [ "$r" != "$f" ] && PAIRS="$PAIRS $f:oppi-mobile/$r" && continue
>   PAIRS="$PAIRS $f:$f"   # oppi-web/ ya mapea directo
> done
> python3 ~/workspace/skills/github/bin/gh-push.py valentinocaratini21-collab oppi \
>   "mensaje del cambio" $PAIRS \
>   /home/hatch/workspace/oppi/README.md:README.md \
>   /home/hatch/workspace/oppi/DEPLOY-GITHUB.md:DEPLOY-GITHUB.md
> ```

## Qué NUNCA subir

- `node_modules/` (se reinstala con `npm install`)
- `data/` (SQLite local: es la DB de desarrollo, producción tiene la suya)
- `.env` (secretos). El template `.env.example` **sí** va al repo.

## Después de pushear

1. Esperar ~3 min (Railway redeploya solo con push a `main`).
2. Verificar: `curl https://<tu-dominio>/api/health` (o `/api/version` si existe).
3. Si el deploy no arranca, revisar en Railway que el servicio esté conectado a
   la rama `main` del repo.
