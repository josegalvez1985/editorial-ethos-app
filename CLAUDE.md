# CLAUDE.md — Juventud con Valores

Instrucciones para Claude Code en este repositorio. **Todo lo que ve Jose va en español.**

## El proyecto en 30 segundos

Sistema de gestión sobre **Oracle APEX/ORDS**, con un sitio web que también se instala como APK.
Detalle completo en [`README.md`](README.md); el backend en [`backend/README.md`](backend/README.md).

| Parte | Stack | Cómo llega a producción |
| --- | --- | --- |
| `backend/` | Oracle PL/SQL + ORDS: un `.sql` idempotente por tabla (`PKG_<TABLA>_ETHOS`) | **Jose lo corre a mano** en APEX (SQL Workshop) |
| `src/` | TanStack Start/Router + Vite 8 + React 19 + React Query + Tailwind 4 + Radix | **Push a `main`** → GitHub Actions → GitHub Pages (www.ethospy.online) en ~2 min |
| `android/` | Capacitor: una cáscara que abre el sitio publicado | APK que se reparte a mano (skill `build-apk`) |
| `mobile/` | App Expo vieja | **No se compila. No tocar.** |

No hay Node backend, NestJS, PostgreSQL, GraphQL, Docker ni pruebas automatizadas. No
introducir tecnologías nuevas sin justificarlo y pedir aprobación.

## Reglas duras

1. **No commit ni push sin pedido explícito.** Un push a `main` publica en producción y llega a
   los teléfonos. Si Jose dijo que no se pushea, vale toda la sesión.
2. **No hay ambiente de prueba.** `npm run dev` y el sitio pegan al mismo ORDS de producción:
   navegar y leer sí; crear, editar o borrar registros solo con aprobación.
3. **Nadie ejecuta SQL contra la base desde aquí.** Se escriben los `.sql`; los corre Jose.
   Si un cambio toca backend y front: **primero el `.sql` en APEX, después el push**.
4. **Tablas compartidas con otra app** (`PERIODOS_POSTULACION`, `POSTULANTES_FACILITADORES`,
   `ANIOS_LECTIVOS.PROCESO_POSTULACION`): cero DDL, verificación previa, no borrar datos que la
   otra app muestre. Ver README → *Una tabla que comparte otra app*.
5. **Secretos**: no leer, imprimir ni copiar `.env`, `*.jks`, `android/keystore.properties`.
6. **El APK** lo compila la sesión principal (nunca un subagente) con la skill `build-apk`, a la
   vista, sin pipes ni segundo plano.
7. No sobrescribir cambios locales de Jose: `git status` antes y después; nada de
   `git stash`, `git checkout -- .` ni `git reset --hard` sin pedido.
8. No cambiar dependencias ni versiones principales sin explicar el impacto y pedir aprobación.

## Convenciones que más se olvidan

- Archivos SQL nuevos: `backend/<tabla>.sql` (sin prefijo `ethos_`).
- Un modal/diálogo no tiene permisos propios: usa los de su página.
- Toda grilla con `grid-cols-1` de base; campos y botones `rounded-xl`.
- Todo reporte con detalle lleva botón Excel que baja todo lo filtrado.
- Si cambia la forma de datos persistidos por React Query, subir `CACHE_BUSTER`.
- Una pantalla espera a tener `data`, no a que `isLoading` dé `false` (la caché se restaura).
- En PL/SQL, ningún `BOOLEAN` dentro de un SQL: banderas `'S'`/`'N'`.
- `src/routeTree.gen.ts` es generado. Los íconos de menú existentes no se tocan.
- Antes de diagnosticar "no funciona", verificar que el código esté desplegado.

## Validación

Sin framework de pruebas. Ver skill `validar-cambios`:

- `npx tsc --noEmit` (pasaba limpio el 24/11/2026)
- `npx eslint <archivos cambiados>` (`npm run lint` recorre todo el repo y tarda minutos)
- `npm run build:static` (lo mismo que el CI)

No afirmar que algo pasó si no se corrió. Los `.sql` y el flujo contra ORDS no se pueden
verificar desde aquí: decirlo y dejar la prueba manual para Jose.

## Equipo de agentes (`.claude/agents/`)

La sesión principal coordina: analiza el pedido, elige **el mínimo equipo** que lo cubre,
delega, integra y comunica. Los subagentes no se hablan entre sí ni lanzan otros agentes.

| Agente | Modelo | Acceso | Para qué |
| --- | --- | --- | --- |
| `ux-ui-designer` | sonnet | solo lectura | Auditoría UX/UI, propuesta y criterios de aceptación |
| `frontend-developer` | sonnet | edita | Implementar en `src/` |
| `backend-developer` | sonnet | edita | `backend/*.sql`: paquetes PL/SQL y handlers ORDS |
| `database-architect` | sonnet | solo lectura | Modelo Oracle, constraints, triggers, verificación previa, rollback |
| `api-specialist` | sonnet | solo lectura | Contrato `backend/<tabla>.sql` ↔ `src/lib/<tabla>.ts` |
| `qa-engineer` | sonnet (haiku si es rutina) | lectura + comandos | Criterios, validación, regresiones, reproducir errores |
| `security-engineer` | opus | lectura + comandos | Auditoría defensiva con evidencia |
| `devops-engineer` | sonnet | edita config | Workflow de Pages, build, dominio; no publica |
| `code-reviewer` | sonnet (opus si es sensible) | lectura + comandos | Revisión independiente del diff |
| `technical-writer` | haiku | edita docs | README y guías, con información verificada |

**Arquitectura / cambios transversales** (el "arquitecto de software"): los planifica la sesión
principal, que corre en opus, o el agente integrado `Plan`. `fable` solo con justificación
explícita (rediseño muy amplio o decisión de alto impacto); nunca como predeterminado.

### Política de optimización de consumo

Desde el 25/11/2026, a pedido de Jose. Los subagentes **no son gratis**: lo que consumen sale
del mismo límite de uso. Ahorran contexto cuando uno especializado investiga solo lo relevante
y devuelve un resumen; gastan de más cuando varios analizan lo mismo o todos corren en opus.

1. **Ejecución directa para lo simple.** Un texto, un estilo, un bug evidente o algo que se
   resuelve en dos pasos lo hace la sesión principal, sin agentes.
2. **Delegar solo si aporta**: especialización, contexto independiente (revisar muchos archivos
   y traer un resumen) o trabajo en paralelo de verdad.
3. **Sin agentes duplicados**: nunca dos agentes investigando lo mismo, ni re-delegar un
   análisis que ya se hizo en la sesión. Lo que ya se averiguó se le pasa al agente en el
   pedido, para que no lo vuelva a buscar.
4. **Modelo según la tarea** (el `model` del Agent pisa el del frontmatter):
   - `haiku` para lo rutinario: correr `tsc`/`eslint`/`build` y reportar (qa-engineer),
     documentar lo ya verificado (technical-writer).
   - `sonnet` para implementar, revisar y analizar el día a día: es el predeterminado.
   - `opus` solo para decisiones complejas y auditorías importantes: security-engineer, y el
     code-reviewer cuando el cambio es grande o sensible (login, token, permisos, SQL dinámico,
     tablas compartidas, asistente con IA, Cloudinary).
5. **Skills mínimas**: cada agente precarga solo las 1 o 2 que necesita; no cargar otras.
6. **Resúmenes, no copias**: todo subagente devuelve un informe conciso —hallazgos, decisiones,
   archivos tocados y `archivo:línea`— sin pegar los archivos que leyó ni salidas enteras de
   comandos (solo las líneas que importan).

### Qué agentes según el pedido

| Pedido | Agentes |
| --- | --- |
| Modernizar una pantalla existente | ux-ui-designer → (aprobación de Jose) → frontend-developer → qa-engineer → code-reviewer |
| Pantalla nueva o página de APEX | skill `modulo-apex`; database-architect si hay tabla nueva; backend-developer; frontend-developer; qa-engineer |
| Catálogo de un nombre | backend-developer + frontend-developer (patrón `paises`), sin UX |
| Crear o modificar tablas | database-architect → backend-developer → qa-engineer |
| Endpoint nuevo o cambio de contrato | api-specialist → backend-developer y/o frontend-developer |
| Corregir un error | skill `diagnosticar-error` (qa-engineer o Explore) → especialista que corrige → code-reviewer si no es trivial |
| Revisar seguridad | security-engineer + code-reviewer |
| Preparar despliegue / build roto | devops-engineer; qa-engineer y security-engineer según riesgo |
| Documentar | technical-writer, con lo que ya verificaron los especialistas |

Un cambio chico y claro (un texto, un estilo, un bug evidente) lo hace la sesión principal sin
agentes.

### Coordinación

- Análisis independientes pueden ir en paralelo; **nunca dos agentes editando los mismos
  archivos** ni tareas dependientes en paralelo.
- Solo `backend-developer` edita `backend/*.sql`; `database-architect` y `api-specialist`
  entregan su propuesta en el informe.
- Si hay desacuerdo técnico, presentar alternativas, impacto y recomendación.
- El consumo se rige por la *Política de optimización de consumo* de arriba.

## Protocolo de trabajo

1. **Descubrimiento**: leer README/backend README de la zona, `git status`, módulos afectados.
   Separar hechos de supuestos.
2. **Plan** (para cambios amplios, sensibles o destructivos, esperar aprobación): objetivo,
   diagnóstico, agentes y por qué, archivos, riesgos, pruebas, dudas para Jose.
3. **Implementación**: cambios chicos y coherentes; sin tocar archivos ajenos a la tarea; sin
   eliminar funciones ni alterar contratos sin autorización.
4. **Validación**: ver arriba. Para UI: celular y escritorio, claro y oscuro, foco y contraste.
5. **Entrega**: resumen, archivos, agentes usados, validaciones con su resultado real, qué
   `.sql` hay que correr y en qué orden, riesgos, pruebas manuales.

### Modernizar una pantalla

No empezar programando. UX/UI audita y propone → se presenta a Jose y se espera su
aprobación → frontend implementa por módulos sin quitar funciones → QA → code-reviewer →
despliegue solo con autorización. Mobile-first real (el APK es el mismo sitio), estados de
carga/error/vacío/éxito, accesibilidad, sin textos ni datos de ejemplo presentados como reales.

## Skills del proyecto (`.claude/skills/`)

| Skill | Para qué |
| --- | --- |
| `backend-ords` | Escribir/revisar `backend/*.sql` |
| `frontend-sitio` | Convenciones de `src/`, diseño, marca y accesibilidad |
| `modulo-apex` | Pasar una página de APEX o crear una pantalla nueva, de punta a punta |
| `validar-cambios` | Qué correr y cómo reportarlo |
| `diagnosticar-error` | Ubicar la capa de un error antes de corregir |
| `seguridad-app` | Checklist de seguridad de este sistema |
| `deploy-web` | Publicación en Pages, orden con el SQL, verificar y volver atrás |
| `documentar-cambios` | Dónde y cómo se documenta cada cambio |
| `build-apk` | Compilar el APK |

Integrados que complementan: `/code-review`, `/security-review`, `/simplify`,
`frontend-design`.
