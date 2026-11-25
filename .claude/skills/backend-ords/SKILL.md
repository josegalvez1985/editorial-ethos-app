---
name: backend-ords
description: Convenciones para escribir o revisar el backend Oracle de este proyecto — scripts backend/<tabla>.sql idempotentes con paquete PKG_<TABLA>_ETHOS y handlers ORDS en el módulo ethos. Usar al crear o modificar endpoints, paquetes PL/SQL, tablas, triggers _JNTRG o permisos por página. Reemplaza, para este repo, a nodejs/nestjs/postgresql/rest-api-design/database-migrations.
---

# Backend Oracle APEX / ORDS

La fuente de verdad es `backend/README.md`. Esta skill es el checklist; ante la duda, lee la
sección citada.

## Antes de escribir

- [ ] Leer en `backend/README.md`: la tabla de scripts (orden y dependencias), *Pasar una
      página de APEX: el backend*, *Agregar un endpoint de negocio* y la sección del módulo.
- [ ] Elegir un script modelo existente y copiar su estructura:
  - catálogo de un nombre → `paises.sql`
  - tabla nueva que pasa Jose (crear si no existe + `_JN` + `_JNTRG`) → `envios_graficas.sql`
  - preflight `OPTIONS` a prueba de fallos → `intervenciones.sql`
  - ficha grande con listas (JSON en un campo `datos`) → `facilitadores.sql`
  - tabla compartida con otra app (verificación previa, cero DDL) →
    `periodos_postulacion.sql`, `postulantes_facilitadores.sql`
- [ ] ¿La tabla la usa otra app? Entonces: **nada de DDL** si existe, verificación previa de
      solo lectura en el encabezado, no borrar ni "limpiar" datos que la otra app muestre.

## Reglas del script

- `backend/<tabla>.sql` (sin prefijo `ethos_`), un paquete `PKG_<TABLA>_ETHOS` por tabla.
- **Idempotente**: `[SKIP]` si el objeto existe; `CREATE OR REPLACE` en paquetes; nunca
  `ORDS.DEFINE_MODULE` (lo define solo `auth.sql`).
- ASCII. Textos con ñ/tildes con `UNISTR('a\00f1o')`; en `UNION`, `TO_CHAR(UNISTR(...))`.
- **Ningún `BOOLEAN` de PL/SQL dentro de un SQL** (ni `INSERTING`): antes de 23ai no compila y
  deja INVALID el paquete entero. Banderas `VARCHAR2(1)` `'S'`/`'N'`.
- Un archivo de Cloudinary en una ficha: seguir *Cloudinary* → *Un campo de archivo en una
  ficha* de `backend/README.md` (solo si cambió + anterior → 409, borrar después del COMMIT y
  no si otro módulo usa el enlace).
- Encabezado que lista los endpoints que publica (método, ruta, parámetros, fecha).
- Verificación final que imprime `[OK]` / `[WARN]` / `[INFO]`.

## Reglas de cada endpoint

1. Leer `:authorization`, quitar `Bearer `, `ORDS.DEFINE_PARAMETER` del header **una vez por
   handler** (si falta: "Token invalido o expirado" con un token bueno).
2. `l_usuario := PKG_AUTH_ETHOS.VALIDAR_TOKEN(p_token)` → 401 si es NULL.
3. `GET`: solo sesión. `POST`/`PUT`/`DELETE`: `PKG_ROLES_PAGINAS_ETHOS.puede(l_usuario,
   PKG_ROLES_PAGINAS_ETHOS.pagina_de_ruta('/ruta'), 'I'|'U'|'D')` → 403 con mensaje útil.
   Nunca un número de página fijo. Un modal usa la página de su pantalla.
4. `p_error`: `OWA_UTIL.STATUS_LINE` **antes** de `MIME_HEADER`.
5. Preflight `OPTIONS` en bloque aparte con el patrón `preflight(...)`.
6. SQL dinámico solo con binds. Columnas con tilde: buscarlas en `USER_TAB_COLUMNS`.
7. El body: ORDS bindea solo escalares; listas → un campo de texto JSON leído con `APEX_JSON`.
8. Reportes paginados: aceptar `pagina`/`limite` y devolver `total` sin paginar (el Excel
   baja todo).
9. "En uso" = FK que apuntan a la tabla (salvo `_JN`), contadas por id → 409 al borrar.
10. El id lo pone la tabla (identity/trigger). Los totales derivados los calcula el paquete.

## Bitácora

- `_JNTRG` de un export de APEX: reescribir `JN_ORACLE_USER` con
  `SUBSTR(NVL(V('APP_USER'), NVL(SYS_CONTEXT('USERENV','CLIENT_IDENTIFIER'), USER)), 1, 30)`.
- `INSERTING`/`UPDATING` no van dentro de un SQL: calcular antes en una variable.
- `JN_DATETIME` es UTC: devolver con `- 3/24`.

## Datos

- Datos desalineados: la verificación los **cuenta e imprime** el `UPDATE`; no lo corre.
- Nada de `DROP`/`TRUNCATE`/renombres/`DELETE` masivos sin aprobación explícita de Jose.

## Al terminar

- [ ] El contrato de `src/lib/<tabla>.ts` coincide con lo que devuelve el paquete.
- [ ] Fila en la tabla de scripts de `backend/README.md` + sección con endpoints y decisiones.
- [ ] Avisar: **"correr `backend/<tabla>.sql` en APEX antes de pushear el front"** y en qué
      orden respecto de otros scripts.
- [ ] Nadie ejecuta el `.sql` desde aquí: no hay conexión ni base de prueba; lo corre Jose.
