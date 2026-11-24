---
name: deploy-web
description: Cómo se publica el sitio (push a main → GitHub Actions → GitHub Pages en www.ethospy.online), el orden respecto de los scripts SQL, cómo verificar que un deploy llegó y cómo volver atrás. Usar antes de pushear, al preparar un despliegue, cuando algo "no se ve" en producción o al tocar deploy.yml, vite.config.ts, CNAME o build-static.ps1. Versión de este repo de ci-cd-automation/github-workflows/deployment-engineering/production-readiness.
---

# Despliegue del sitio

Fuente de verdad: `DESPLIEGUE.md` y los comentarios de `.github/workflows/deploy.yml`.

## Lo esencial

- **Push a `main` = producción** en ~2 minutos, y el APK (que carga el mismo sitio) lo ve
  enseguida. Por eso: **nunca commit ni push sin que Jose lo pida**.
- El backend **no** se despliega con el push: los `.sql` los corre Jose en APEX. Si el cambio
  toca los dos, **primero el SQL, después el push**.
- El APK casi nunca hace falta recompilarlo (ver README → *¿Hay que repartir un APK nuevo?*).
  Si hace falta, lo hace la sesión principal con la skill `build-apk`.

## Antes de pushear (production readiness)

- [ ] Validación verde (skill `validar-cambios`), incluido `npm run build:static`.
- [ ] Los `.sql` que el front necesita ya están corridos en APEX (preguntar a Jose).
- [ ] `CACHE_BUSTER` subido si cambió la forma de datos persistidos.
- [ ] `CUSTOM_DOMAIN` en `deploy.yml` y `public/CNAME` dicen lo mismo (si se tocaron).
- [ ] `git status` limpio de archivos ajenos a la tarea; nada de `.env`, `.jks`, `.apk`.

## Verificar que llegó

1. **Antes de diagnosticar "no funciona", confirmar que el código está desplegado.**
2. `gh run list --limit 5` y `gh run view <id>`: el run del commit esperado, en verde.
3. Abrir https://www.ethospy.online/ y forzar recarga; la caché de React Query y del
   navegador pueden mostrar lo viejo.
4. Si el sitio responde distinto en `www` y en el github.io, revisar *El bucle de
   redirecciones* en `DESPLIEGUE.md`.

## Volver atrás

- `git revert <commit>` + push (con permiso de Jose): Pages publica el estado anterior.
- O re-ejecutar el run de un commit anterior desde Actions (con permiso).
- Un `.sql` no se revierte con git: necesita su script de rollback, corrido por Jose.

## Prohibido sin aprobación explícita

Push, `gh workflow run`, `gh run rerun`, cambiar Settings de GitHub o el DNS, borrar
artefactos o environments.
