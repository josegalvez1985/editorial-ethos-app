---
name: validar-cambios
description: Qué validaciones existen en este repo y cómo correrlas (type-check, ESLint, build estático), qué no se puede verificar desde aquí (los .sql, el flujo contra ORDS real) y cómo reportarlo con honestidad. Usar al terminar cualquier cambio de código, antes de entregar o de pedir un push. Versión de este repo de test-driven-development/unit-integration-testing/testing-workflow — no hay framework de pruebas.
---

# Validar un cambio

**No hay pruebas automatizadas** (ni Vitest, ni Jest, ni Playwright) ni ambiente de prueba.
Agregar un framework es un cambio de dependencias: se propone, no se instala sin aprobación.

## Validación automática disponible

Correr **en primer plano**, sin pipes que oculten la salida, y reportar el resultado real:

| Paso | Comando | Notas |
| --- | --- | --- |
| Type-check | `npx tsc --noEmit` | Rápido. Pasaba limpio el 24/11/2026: cualquier error es nuevo |
| Lint de lo cambiado | `npx eslint <archivos .ts/.tsx cambiados>` | Preferido. `npm run lint` (`eslint .`) recorre también `mobile/` y `android/` y tarda varios minutos |
| Lint completo | `npm run lint` | Solo si se tocó configuración compartida; en segundo plano, con timeout amplio |
| Build de producción | `npm run build:static` | Es lo que hace el CI; verifica `index.html`, `404.html` y `.nojekyll` |

Archivos cambiados: `git diff --name-only` y `git ls-files --others --exclude-standard`.

Si un comando falla, distinguir **nuevo** (en archivos que el cambio tocó) de
**preexistente**. Nunca usar `git stash`/`git checkout` para comparar.

## Lo que NO se puede verificar desde aquí — decirlo siempre

- **Que un `.sql` compile y funcione**: se corre a mano en APEX. Revisarlo leyendo y dejarle a
  Jose qué mirar en la salida (`[OK]`/`[WARN]`/errores ORA-).
- **El flujo real contra ORDS**: `npm run dev` pega a producción. Navegar y leer está bien;
  crear, editar o borrar registros requiere aprobación explícita.
- **El APK**: carga el sitio publicado; no se prueba hasta que se publica.

## Pruebas manuales para la entrega

Para cambios de interfaz, dejar a Jose una lista concreta:
- Ruta y pasos, con el resultado esperado.
- Celular (≤ 640px) y escritorio ancho; modo claro y oscuro.
- Usuario sin permiso de insertar/borrar (los botones no aparecen; el backend responde 403).
- Estados vacío, error y sin conexión.
- Reportes: el Excel baja todo lo filtrado.

## Formato del reporte

| Verificación | Resultado |
| --- | --- |
| `npx tsc --noEmit` | ✅ sin errores / ❌ N errores (nuevos: …) |
| ESLint (archivos) | … |
| `npm run build:static` | … / no corrido (motivo) |
| `.sql` | no verificable aquí: correr en APEX y revisar … |
| Manual | pendiente para Jose: … |

"No verificado" es una respuesta válida. "Pasó" solo si se corrió y se vio la salida.
