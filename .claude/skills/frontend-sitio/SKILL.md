---
name: frontend-sitio
description: Convenciones del sitio (src/) — TanStack Start/Router, React 19, React Query, Tailwind 4, Radix, marca y temas, responsive, reportes con Excel/PDF, permisos en pantalla. Usar al diseñar, crear, modificar o revisar cualquier pantalla o componente. Reemplaza, para este repo, a react-development/typescript-engineering/responsive-design/modern-ui-ux/accessibility-audit.
---

# Sitio web: convenciones

Fuente de verdad: `README.md` (secciones citadas). Esta skill es el resumen operativo.

## Estructura

| Qué | Dónde |
| --- | --- |
| Pantallas (rutas por archivo) | `src/routes/<ruta>.index.tsx`, `<ruta>.$id.tsx`, `<ruta>.nueva.tsx` |
| Contrato con el backend de cada tabla | `src/lib/<tabla>.ts` (`authFetch`, mapeo snake_case → camelCase, `keys…`) |
| Piezas de listados y formularios | `components/admin-ui.tsx` (`Buscador`, `Cargando`, `Fallo`, `Pastillas`, `BotonPrimario`…) |
| Fichas con secciones/pestañas | `components/ficha-ui.tsx` |
| Catálogos de un nombre (o con padre) | `components/catalogo-nombre.tsx` |
| Grilla tipo APEX (solo Pre-horarios y Postulaciones) | `components/grilla-editable.tsx` |
| Excel / PDF | `boton-excel.tsx`, `lib/excel*.ts`, `lib/pdf-*.ts` |
| Menú y descripciones | `lib/navegacion.ts` (`PANTALLAS`, `ICONOS_MENU`) |
| Temas | `src/styles.css`, `lib/theme.tsx` |
| Caché persistida | `lib/query-persist.ts` (`CACHE_BUSTER`) |

`src/routeTree.gen.ts` es generado: no se edita. `mobile/` no se compila: no se toca.

## Reglas de diseño (README → *Pasar una página de APEX al sitio*, *Pantallas*, *Marca y temas*)

- **Moderno, no copia de APEX**: listados en tarjetas, buscador sin tildes ni mayúsculas,
  filtros en pastillas con `flex-wrap` (nunca scroll horizontal).
- **Sin `max-w-*` que encierre la página**; columnas por breakpoint. **Toda grilla lleva
  `grid-cols-1` de base**: `grid grid-cols-1 gap-3 md:grid-cols-2`.
- Radios: campos, selectores y botones `rounded-xl`; tarjetas y diálogos `rounded-2xl`;
  `rounded-full` **solo** pastillas, insignias, avatares y botones de ícono.
- Primario = navy de la marca, no el rojo. Texto sobre gradientes de marca: `--on-brand`
  (blanco siempre), no `--primary-foreground`. Si cambia un `--background`, actualizar
  `COLOR_BARRA` en `lib/theme.tsx`.
- Probar en claro y oscuro; una paleta solo cambia color.
- Botones fijos (`fixed`) dejan lugar al final de la lista (`pb-16 lg:pb-32`).

## Comportamiento

- **Permisos**: los botones siguen las banderas de la página (sin insertar no hay "Nuevo").
  Un modal o diálogo no tiene permisos propios: usa los de su página.
- **Todo reporte con detalle lleva botón Excel**, que baja todo lo filtrado (junta las
  páginas), y su tabla se ordena y filtra por columna, con marcos verticales.
- **Estados**: carga, error (con reintento), vacío (que diga qué hacer), éxito (`toast`),
  sin permiso, sin conexión.
- **Ubicación en cascada**: se elige el nivel más bajo; el resto lo deriva el backend.
- Si cambia la forma de datos que React Query persiste → subir `CACHE_BUSTER`.
- **Esperar `data`, no `isLoading`**: mientras se restaura la caché, `isLoading` es `false` sin
  datos. `error ? Fallo : !data ? Cargando : <Form inicial={data}/>`; nunca `data!` ni
  `data ?? vacio()` para un registro que existe (README → *Sesión y datos en el dispositivo*).
- **Archivos en Cloudinary**: `subirACloudinary` de `lib/cloudinary.ts` con la ruta de firma del
  módulo; en una ficha que se guarda entera, el enlace viaja solo si cambió, con el anterior
  (patrón de la foto carnet: `backend/README.md` → *Cloudinary*).
- Pantalla nueva: descripción en `PANTALLAS`; **el ícono de menú no se toca** (uno nuevo se
  propone y se agrega solo con el sí de Jose, como línea nueva al final).

## Accesibilidad mínima

Contraste AA en las 22 combinaciones, foco visible, objetivos táctiles ≥ 44px, `label`
asociado a cada campo, diálogos Radix (foco atrapado y `Esc`), íconos solos con
`aria-label`.

## Ver también

- La skill `frontend-design:frontend-design` para dirección estética cuando se rediseña.
- `GUIA_FORMULARIOS.md` para los Formularios 1, 2 y 3.
