# Guía: el equipo de agentes de Claude Code en otro proyecto

Cómo llevar los agentes y skills de **editorial-ethos-app** (24/11/2026) a otro proyecto. Lo que
hay en este repo y por qué está en el [`README`](README.md) → *4. Claude Code: agentes y skills*;
esta guía es solo para copiarlo a otro lado.

La idea de fondo: **los agentes se copian casi enteros, las skills casi nunca.** Un agente dice
*qué rol cumple y qué no puede hacer*, y eso vale en cualquier proyecto. Una skill dice *cómo se
hacen las cosas en este repo*, y en otro stack enseña lo que no corresponde.

## 0. Qué hay y qué se lleva

| Archivo | ¿Se copia? | Qué hay que cambiar |
| --- | --- | --- |
| `.claude/agents/*.md` (10) | Sí | El bloque de stack de cada uno y las skills que precarga (ver 2) |
| `.claude/skills/backend-ords`, `frontend-sitio`, `modulo-apex`, `deploy-web` | **Solo si el otro proyecto es Oracle APEX/ORDS + React con GitHub Pages** | Rutas, nombres de paquetes, dominio |
| `.claude/skills/validar-cambios`, `diagnosticar-error`, `seguridad-app`, `documentar-cambios` | Como plantilla | Los comandos, los síntomas y las secciones de la documentación del otro proyecto |
| `.claude/skills/build-apk` | Solo si hay un APK de Capacitor | Todo lo de rutas y firma |
| `CLAUDE.md` | Como plantilla | La tabla del proyecto, las reglas duras y la tabla de ruteo |

## 1. Copiar

Desde la raíz del otro proyecto (PowerShell):

```powershell
$origen = "C:\Users\josej\OneDrive\Desktop\Proyectos\editorial-ethos-app.git"
New-Item -ItemType Directory -Force .claude\agents, .claude\skills | Out-Null
Copy-Item "$origen\.claude\agents\*.md" .claude\agents\
# Solo las skills que apliquen (ver la tabla de arriba):
Copy-Item "$origen\.claude\skills\validar-cambios" .claude\skills\ -Recurse
```

**No copiar** `.claude/settings.json` ni `.claude/settings.local.json`: son los permisos de esta
PC y de este repo.

## 2. Adaptar cada agente

Cada agente tiene tres partes. Solo la del medio depende del proyecto:

1. **Frontmatter**: `name`, `description`, `tools`, `model`, `color` y `skills`. Se deja igual,
   salvo `skills`: quitar las que no se copiaron, o el agente arranca sin ellas.
2. **Contexto del stack** (los bloques "Stack real", "Realidad del proyecto", "Superficie real",
   y las notas `>` que dicen "este proyecto no tiene backend Node"): se reescriben con lo que
   haya en el otro proyecto.
3. **Cómo trabajas / Qué entregas / Límites**: se dejan. Son la especificación.

Si el otro proyecto **sí** usa Node/NestJS o PostgreSQL, `backend-developer` y
`database-architect` vuelven a lo que pedía la especificación original: reescribir su bloque de
stack con eso.

### La política de modelos

| Modelo | Agentes | Por qué |
| --- | --- | --- |
| `opus` | security-engineer (y la sesión principal, que hace de arquitecto) | Auditorías importantes y decisiones complejas |
| `sonnet` | ux-ui-designer, frontend-developer, backend-developer, database-architect, api-specialist, qa-engineer, devops-engineer, code-reviewer | Implementación, análisis y revisión del día a día |
| `haiku` | technical-writer | Tarea acotada y de bajo riesgo |
| `fable` | ninguno | Solo con justificación explícita, desde la sesión principal |

Hasta el 25/11/2026 ux-ui-designer, database-architect y code-reviewer iban en `opus`; se
bajaron a `sonnet` para ahorrar consumo. Para una tarea puntual la sesión pisa el modelo: `opus`
al code-reviewer en un cambio grande o sensible, `haiku` al qa-engineer cuando solo corre las
validaciones. Al llevar el equipo a otro proyecto, copiar también la *Política de optimización
de consumo* de `CLAUDE.md`.

Siempre por **alias**, nunca un ID de modelo escrito a mano: el alias toma la versión vigente.
Si una documentación tiene la redacción delicada (como la de este repo, con muchas decisiones
fechadas), conviene subir `technical-writer` a `sonnet`.

### Los permisos

| Tipo | `tools` | Agentes |
| --- | --- | --- |
| Solo lectura | `Read, Grep, Glob` | ux-ui-designer, database-architect, api-specialist |
| Lectura + comandos | `Read, Grep, Glob, Bash` | qa-engineer, security-engineer, code-reviewer |
| Edita | `Read, Grep, Glob, Edit, Write, Bash` | frontend-developer, backend-developer, devops-engineer |
| Edita sin comandos | `Read, Grep, Glob, Edit, Write` | technical-writer |

Ninguno tiene `Agent`: un subagente no lanza a otro, coordina la sesión principal. Los que
tienen `Bash` pueden escribir igual por la terminal; lo que los frena es su instrucción, no la
herramienta. Para un freno de verdad, una regla `deny` en `.claude/settings.json`.

## 3. Escribir las skills del otro proyecto

Una skill buena para un proyecto es **un checklist corto que apunta a su documentación**, no una
copia de ella:

- **Una por procedimiento que se repite** (crear un módulo, validar, publicar, diagnosticar),
  no una por tecnología.
- La `description` dice **cuándo usarla** con las palabras con que se pide ("no funciona", "pasar
  la página N").
- Cada regla con su **por qué** o la sección donde está.
- Nada de skills de un stack que el proyecto no usa: empujan a Claude a proponerlo.
- Para crearlas o mejorarlas está la skill `skill-creator`.

## 4. El CLAUDE.md

Partir del de este repo y mantener las secciones:

1. **El proyecto en 30 segundos**: qué partes hay y cómo llega cada una a producción.
2. **Reglas duras**: lo que no se hace sin pedido. Las de este repo que valen casi siempre: no
   pushear sin pedido, no tocar producción ni datos reales, no leer secretos, no pisar cambios
   locales, no cambiar dependencias sin aprobación.
3. **Validación**: los comandos que existen de verdad en el otro proyecto.
4. **Equipo de agentes** y **qué agentes según el pedido**.
5. **Protocolo**: descubrimiento → plan → implementación → validación → entrega.

Los subagentes leen `CLAUDE.md` pero **no** la memoria personal de Claude: lo que tienen que
respetar todos va en `CLAUDE.md`.

## 5. Prueba final

1. Validar el YAML de todos los frontmatter. **Un `: ` dentro de la `description` lo rompe**:
   usar `—` o poner la descripción entre comillas.
   ```powershell
   node -e "const fs=require('fs'),y=require('js-yaml');for(const f of fs.readdirSync('.claude/agents'))y.load(fs.readFileSync('.claude/agents/'+f,'utf8').split('---')[1]);console.log('ok')"
   ```
2. Abrir una sesión **nueva** de Claude Code (los agentes y skills se cargan al arrancar).
3. `/agents` para ver los agentes; las skills aparecen al escribir `/`.
4. Pedir algo chico nombrando un agente (*"que el code-reviewer revise el último commit"*) y
   comprobar en `/tasks` que corre con el modelo esperado.
