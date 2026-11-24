---
name: modulo-apex
description: Proceso de punta a punta para pasar una página de Oracle APEX al sitio, o crear una pantalla nueva que no viene de APEX — backend .sql, lib, ruta, menú, permisos, Excel, documentación y orden de publicación. Usar cuando se pida "pasar la página N de APEX", "un módulo nuevo", "una pantalla para la tabla X". Es la versión de este repo de legacy-modernization y requirements-analysis.
---

# Módulo nuevo (página de APEX o pantalla nueva)

Fuente de verdad: `README.md` → *Sumar un módulo*, *Pasar una página de APEX al sitio*, *Una
pantalla nueva que no viene de APEX*, *Una tabla que comparte otra app*.

## 1. Preguntas antes de empezar (requisitos)

Resolver con lo que ya hay en el repo; preguntar a Jose solo lo que no se pueda deducir:

- ¿Qué página de APEX es (número)? ¿Ya está en `backend/menu_paginas.sql` con su ruta?
- ¿Qué modales tiene? (Serán diálogos de la misma pantalla, con sus permisos.)
- ¿Tabla existente, tabla nueva (Jose pasa el DDL) o **tabla compartida con otra app**?
- ¿Es un ABM, una ficha con listas, un reporte (→ Excel obligatorio) o una mezcla?
- ¿Qué combos necesita el formulario (vienen livianos en el mismo `GET`)?
- ¿Formato especial pedido por otra app o por Jose (Markdown, PDF con un formato dado)?

## 2. Equipo sugerido

| Paso | Agente |
| --- | --- |
| Modelo de datos (si hay tabla nueva o dudas de FK/triggers) | `database-architect` |
| Contrato de endpoints | `api-specialist` (si es más que un CRUD estándar) |
| `backend/<tabla>.sql` | `backend-developer` |
| Propuesta de pantalla | `ux-ui-designer` (si no encaja en un patrón existente) |
| `src/lib/<tabla>.ts` + ruta | `frontend-developer` |
| Validación | `qa-engineer` |
| Revisión del diff | `code-reviewer` |
| Documentación | `technical-writer` |

Un catálogo de un nombre no necesita UX ni api-specialist: `<CatalogoNombre>` + `paises.sql`
como modelo.

## 3. Checklist

Backend (skill `backend-ords`):
- [ ] `backend/<tabla>.sql` + `PKG_<TABLA>_ETHOS`, idempotente, permisos por ruta.
- [ ] Tabla nueva: crear solo si no existe, con `_JN`, `SEQ_AUDITORIA` y `_JNTRG` reescrito.

Front (skill `frontend-sitio`):
- [ ] `src/lib/<tabla>.ts` con el contrato.
- [ ] `src/routes/<ruta>.index.tsx` (y `$id` / `nueva` si es ficha).
- [ ] Descripción en `PANTALLAS` (`lib/navegacion.ts`). Ícono: el de `ICONOS_MENU` si viene
      de APEX; si es nueva, **proponerlo** y agregarlo solo con el sí.
- [ ] Botones según permisos; Excel si es reporte con detalle.
- [ ] `CACHE_BUSTER` si cambió la forma de datos persistidos.

Menú y permisos (los hace Jose en el sitio, no el código):
- [ ] Página de APEX: ya existe en `MENU_PAGINAS`; sus permisos valen.
- [ ] Pantalla nueva: alta en **Administrador → Crear páginas** y permisos en **Roles de
      páginas**. Hasta entonces el `GET` anda y la escritura responde 403 explicándolo.

Documentación (skill `documentar-cambios`):
- [ ] Fila en *Los módulos de hoy* (`README.md`).
- [ ] Fila en la tabla de scripts + sección en `backend/README.md`.

## 4. Orden de publicación

1. Jose corre `backend/<tabla>.sql` en APEX (y sus dependencias, en orden).
2. Recién entonces, y solo si Jose lo pide, commit + push (publica en ~2 min).
3. Pantalla nueva: Crear páginas + Roles de páginas.
4. Verificar en https://www.ethospy.online/ (skill `deploy-web`).
