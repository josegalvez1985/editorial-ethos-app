---
name: documentar-cambios
description: Dónde y cómo se documenta cada tipo de cambio en este repo (README.md, backend/README.md, DESPLIEGUE.md, APK.md, comentarios de cabecera en .sql y lib/*.ts), con el estilo de la casa — fechas, el porqué y las "historias". Usar al terminar un módulo, endpoint o decisión, o al redactar notas de cambio. Reemplaza en este repo a technical-decision-records/documentation-engineering — las decisiones se registran en la sección del módulo, no en una carpeta de ADRs.
---

# Documentar cambios

## Dónde va cada cosa

| Cambio | Dónde |
| --- | --- |
| Módulo o pantalla nueva | `README.md` → *Los módulos de hoy* (una fila) |
| Script SQL nuevo | `backend/README.md` → tabla de scripts (qué trae, orden) + una sección con endpoints y decisiones |
| Endpoint nuevo en un script existente | La sección del módulo en `backend/README.md` + el encabezado del `.sql` |
| Regla de diseño o de UI | `README.md` → *Pantallas…*, *Marca y temas* o *Reportes…* |
| Trampa de Oracle/ORDS aprendida | `backend/README.md` → *Pasar una página de APEX: el backend* |
| Build, dominio, Pages | `DESPLIEGUE.md` |
| APK, firma, Capacitor | `APK.md` |
| Por qué un archivo es como es | Comentario de cabecera del archivo (`lib/<tabla>.ts`, `.sql`) |
| Pendiente o riesgo conocido | `backend/README.md` → *Pendientes conocidos* |

No crear archivos de documentación nuevos (ni carpeta `docs/` ni ADRs) sin pedido.

## Estilo

- Español, directo, segunda persona o impersonal, como el resto del repo.
- **Fechas absolutas** `dd/mm/aaaa` y, si viene de un pedido, quién lo pidió ("Jose,
  24/11/2026").
- **El porqué** de cada decisión, y la alternativa descartada si alguien podría "arreglarla"
  sin querer.
- Las "historias" (qué había antes y por qué se cambió) no se borran.
- Enlaces relativos en markdown a archivos del repo; código y objetos entre backticks.
- Tablas para listas de módulos, endpoints y archivos.

## Verificación

- Cada ruta, comando, paquete, endpoint y nombre de archivo existe (`Glob`/`Grep`).
- Nada de valores secretos: solo el nombre de la variable y para qué sirve.
- Fin de línea: git guarda LF, pero con `core.autocrlf=true` el disco tiene CRLF. Antes de
  editar con un script, mirar `git ls-files --eol <archivo>` y respetar el de la copia de
  trabajo.
- Si cambia una convención que resume una skill de `.claude/skills/`, actualizar también la
  skill (README → *4. Claude Code* → *Mantenerlos al día*).
