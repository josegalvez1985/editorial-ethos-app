---
name: seguridad-app
description: Checklist de seguridad defensiva específico de este sistema (token ORDS, permisos ROLES_PAGINAS, PL/SQL dinámico, CORS, asistente con IA que ejecuta SQL, firma de Cloudinary, XSS en el front, secretos y dependencias). Usar al revisar cambios sensibles o pedir una auditoría. Complementa a la skill integrada security-review; es la versión de este repo de application-security, authentication-authorization, database-security y dependency-audit.
---

# Seguridad de la aplicación

Solo análisis defensivo sobre el repo. Nada de pruebas activas contra ORDS, oracleapex.com,
Cloudinary ni la API de Claude. Nunca copiar un secreto a un informe.

## Autenticación (`backend/auth.sql`, `src/lib/api.ts`)
- [ ] Todo handler protegido valida el token; `UPPER()` en usuario y token, consistente.
- [ ] El token sigue en `sessionStorage`, nunca `localStorage` (decisión documentada).
- [ ] La contraseña recordada: ver "Recordar usuario y contraseña" en `api.ts`; no ampliar.
- [ ] Logout revoca (`ACTIVO='N'`). Expiración detectada por status **y** mensaje.

## Autorización
- [ ] Escritura con `PKG_ROLES_PAGINAS_ETHOS.puede(..., pagina_de_ruta('/ruta'), ...)`.
- [ ] Un módulo nuevo o tocado: ¿controla permisos en el backend o solo pide sesión? (ver
      `backend/README.md` → *El menú no es la seguridad*). Un botón oculto no es control.
- [ ] Datos de un registro: ¿un usuario puede pedir el `:id` de otro que no debería ver?

## PL/SQL
- [ ] `EXECUTE IMMEDIATE` / `DBMS_SQL` / `OPEN ... FOR` con texto: solo binds; nombres de
      objeto validados contra el diccionario (`DBMS_ASSERT` o lista blanca).
- [ ] Mensajes de error que no filtran SQL ni estructura interna.
- [ ] Sin `GRANT`s amplios ni objetos públicos nuevos.

## Asistente con IA (`ia_asistente.sql`)
- [ ] Sigue siendo solo lectura: `validar` + `consultar` + `SET TRANSACTION READ ONLY`.
- [ ] El filtro de identificadores no se puede saltar (comentarios, `q'...'`, dblinks,
      `WITH FUNCTION`, funciones del sistema, tablas `IA_*`/`ETHOS_TOKENS`).
- [ ] Prompt injection desde datos de la base: el resultado de una consulta no puede darle
      herramientas que escriban. No agregar herramientas de escritura.
- [ ] Límite diario por usuario vigente.

## Archivos (`cloudinary.sql`, facturas, postulantes)
- [ ] Firma generada en Oracle; el secreto nunca viaja al navegador.
- [ ] Se valida que un enlace guardado sea del cloud propio.
- [ ] Tipos y tamaños acotados.

## Front
- [ ] Sin `dangerouslySetInnerHTML` con datos; `components/markdown.tsx` no renderiza HTML
      crudo ni `javascript:` en links.
- [ ] Sin datos sensibles en logs, URLs ni en la caché persistida (`query-persist.ts`).
- [ ] Links externos con `rel="noopener noreferrer"`.

## Infraestructura y secretos
- [ ] `.env`, `*.jks`, `android/keystore.properties` siguen en `.gitignore` y no trackeados
      (`git ls-files`).
- [ ] `VITE_API_URL` es pública a propósito; no meter nada secreto en variables `VITE_*`.
- [ ] Workflow: sin `${{ }}` interpolado dentro de `run` con datos controlables.
- [ ] `.claude/settings*.json`: reglas `allow` que permitan comandos destructivos.
- [ ] Dependencias: `npm audit --omit=dev` (solo lectura); reportar, no actualizar sin
      aprobación.

## Pendientes conocidos (no reportarlos como nuevos)
Sin rate limiting; token de 6 h sin renovación; varios módulos sin control de permisos en el
backend; CORS `*` obligatorio. Sí señalar si un cambio los **empeora**.

## Formato del hallazgo
Severidad · archivo:línea · entrada que controla el atacante · qué obtiene · mitigación ·
¿nuevo o preexistente?
