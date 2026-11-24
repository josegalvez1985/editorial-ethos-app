---
name: diagnosticar-error
description: Diagnóstico sistemático de un error en este sistema — ubicar si está en el despliegue, la caché del navegador, el front, la red/CORS, ORDS o el paquete PL/SQL — antes de corregir. Usar cuando Jose diga "no funciona", "da error", "no se ve", "no guarda", "me saca del login" o pegue un mensaje ORA-/HTTP. Versión de este repo de debugging-systematic.
---

# Diagnosticar un error

Primero ubicar la capa; después corregir. No proponer un arreglo sin evidencia de la causa.

## 0. ¿Está desplegado lo que creemos?

Antes que nada: el código del que hablamos, ¿llegó a producción?
- `git log origin/main --oneline -5` y `gh run list --limit 5`: ¿se pusheó? ¿el run terminó
  en verde?
- ¿El `.sql` que el front necesita se corrió en APEX? (Solo Jose lo sabe: preguntar.)
- Recarga forzada; la caché persistida de React Query puede servir datos con forma vieja
  (¿hace falta subir `CACHE_BUSTER`?).

## 1. Reproducir

Pantalla, usuario (¿tiene permisos?), datos, pasos, celular/escritorio, sitio o APK.
Pedir el mensaje exacto, el status HTTP y, si se puede, la pestaña Red de DevTools (en el APK,
`chrome://inspect`, ver `APK.md`).

## 2. Mapa de síntomas frecuentes

| Síntoma | Capa probable | Dónde mirar |
| --- | --- | --- |
| "Token invalido o expirado" con un login recién hecho | ORDS | Falta `ORDS.DEFINE_PARAMETER` del header en ese handler |
| 403 al guardar en pantalla nueva | Permisos | Página sin alta en Crear páginas o sin permisos en Roles de páginas |
| 404 en un endpoint | Despliegue backend | El `.sql` no se corrió, o un re-run de `auth.sql` viejo borró handlers |
| Error de CORS solo en producción/APK | ORDS | Preflight `OPTIONS` del template; en dev pasa por el proxy y no se ve |
| 500 genérico de ORDS | PL/SQL | Error no capturado; ver `backend/README.md` → *Si Auditoría responde el 500 genérico* |
| 200 con `success:false` | `p_error` | `STATUS_LINE` después de `MIME_HEADER` |
| ORA-12704 | SQL | `UNISTR` en un `UNION` sin `TO_CHAR` |
| ORA-04084 | Trigger | Asigna `:NEW` en DELETE |
| ORA-01400 en la PK | Tabla | Sin identity/trigger para el id |
| Pantalla revienta tras un cambio de forma de datos | Caché | `CACHE_BUSTER` sin subir |
| Página corrida de costado en celular | CSS | Grilla sin `grid-cols-1` de base |
| Texto ilegible en oscuro sobre gradiente | Tema | `--primary-foreground` en vez de `--on-brand` |
| Sitio no responde en www ni en github.io | DNS/Pages | `DESPLIEGUE.md` → *El bucle de redirecciones* |
| El teléfono no cambia tras pushear | APK/caché | `README.md` → *Si pusheaste y el teléfono no cambia* |

## 3. Hipótesis y evidencia

Listar hipótesis ordenadas por probabilidad, con la evidencia a favor y en contra de cada una
y qué prueba (de solo lectura) la descarta. Leer el código de las dos puntas: `src/lib/<tabla>.ts`
y el handler + paquete en `backend/<tabla>.sql`.

## 4. Entregar

Causa raíz (o la más probable, marcada como tal), evidencia, corrección propuesta y quién la
hace (frontend, backend, Jose en APEX), y cómo verificar que quedó resuelto.
