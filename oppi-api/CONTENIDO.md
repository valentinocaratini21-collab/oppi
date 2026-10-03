# Agente CONTENIDO — calendario pre-lanzamiento de Oppi

El agente Contenido genera los borradores de Instagram para el pre-lanzamiento (octubre 2026 → enero 2027). No usa API keys: trabaja con **plantillas + reglas**, con la voz de Oppi.

## La voz de Oppi

- **Voseo rioplatense**, tono cercano y directo. Nada corporativo.
- **Beneficios concretos**, no humo: "reservás en 30 segundos", "la seña queda protegida", "ves el precio antes".
- **CTA claro** en cada posteo: "Seguinos", "Probalo gratis", "Guardá este posteo".
- **Hashtags**: `#Oppi #Paraguay #Asunción` + uno del rubro (`#BellezaPy`, `#Hogar`, `#Barbería`…).

## El calendario

**42 borradores**: 3 posteos por semana (lun/mié/vie) × 14 semanas, del 2026-10-05 al 2027-01-08.

| Semanas | Kind | Idea |
|---|---|---|
| 1–10 (rotando) | `beneficio` | Por qué Oppi te sirve ("Reservá sin llamar por teléfono") |
| 1–10 (rotando) | `como_funciona` | Paso a paso ("Así se reserva en Oppi") |
| 1–10 (rotando) | `prueba_social` | Historias genéricas ("María ya atiende con Oppi") |
| 11–14 | `countdown` | Cuenta regresiva al lanzamiento ("Faltan X días") |

> Los nombres de `prueba_social` (María, Carlos, Lucía…) son **personas ilustrativas**, placeholders hasta tener testimonios reales. Nunca presentarlos como clientes verificados: cuando haya profesionales reales registrados, reemplazar esos borradores por sus historias de verdad.

## Comandos

Desde la raíz del repo (`oppi-api/`):

```bash
node scripts/content.js --dry-run        # Imprime los 42 borradores (no inserta nada)
node scripts/content.js                 # Genera e inserta el calendario
node scripts/content.js --list          # Todos los borradores
node scripts/content.js --list --status=draft
node scripts/content.js --approve 7     # Aprueba el borrador #7
```

La generación es **anti-duplicados**: si `content_drafts` ya tiene filas, no inserta nada.

> Para no ensuciar la DB de desarrollo: `DB_PATH=/tmp/oppi-test.db node scripts/content.js`

## Flujo de aprobación

```
revisar (--list / leer el caption) → --approve <id> → publicar MANUAL en Instagram
```

1. **Revisar**: leé el borrador con `--list` (o directo en la DB). Si el caption no te convence, editalo a mano en la DB o marcalo `discarded`.
2. **Aprobar**: `node scripts/content.js --approve <id>` pone `status='approved'` + `approved_at`. El campo `approved_by` queda en NULL porque la aprobación es manual desde el CLI (se loguea como "aprobación manual CLI"). Solo se puede aprobar desde `draft`.
3. **Publicar**: lo publicás **vos, a mano, en Instagram**, en la fecha de `scheduled_for`.
4. **Registrar**: después de publicar, marcás `published` **a mano en la DB**:
   ```sql
   UPDATE content_drafts SET status = 'published' WHERE id = <id>;
   ```

## ⛔ Regla dura: jamás auto-publicar

No existe **ningún comando ni ningún path de código** que ponga `status='published'`. Es deliberado:

- `content.js` solo escribe `draft` (al generar) y `approved` (con `--approve`).
- `published` solo lo pone un humano, con SQL a mano, después de publicar de verdad en Instagram.
- `discarded` también es manual, para los borradores que no van.

Si algún día se quiere publicar automáticamente, eso requiere una decisión explícita del dueño y código nuevo con su aprobación. Hasta entonces: **nada se publica sin un humano en el medio**.

## Qué necesita del dueño

- **Cuenta de Instagram de Oppi** para publicar los posteos aprobados (la publicación es manual).
- **Revisión humana** de los 42 borradores antes de aprobar: el tono es plantilla, tu ojo es el filtro final.
- **Fotos/videos** para acompañar cada posteo (el script genera texto + hashtags; lo visual lo ponés vos).
- Cuando haya profesionales reales: reemplazar los `prueba_social` ilustrativos por testimonios verdaderos.
