# Routes

TanStack Start uses **file-based routing**. Every `.tsx` file in this directory
defines a route. Do **not** create `src/pages/`, `src/routes/_app/index.tsx`, or
`app/layout.tsx` — those are Next.js / Remix conventions. The only root layout
is `src/routes/__root.tsx`.

## Conventions

| File | URL |
| --- | --- |
| `index.tsx` | `/` |
| `about.tsx` | `/about` |
| `users/index.tsx` | `/users` |
| `users/$id.tsx` | `/users/:id` (dynamic — bare `$`, no curly braces) |
| `posts/{-$category}.tsx` | `/posts/:category?` (optional segment) |
| `files/$.tsx` | `/files/*` (splat — read via `_splat` param, never `*`) |
| `_layout.tsx` | layout route (renders children via `<Outlet />`) |
| `__root.tsx` | app shell — wraps every page; preserve `<Outlet />` |

`routeTree.gen.ts` is auto-generated. Don't edit it by hand.

Si la pantalla reemplaza una página de APEX, seguí la guía del [`README`](../../README.md) →
*Pasar una página de APEX al sitio*.

## Una ruta nueva no aparece sola en el menú

El menú sale de la base (`MENU_PAGINAS` + `ROLES_PAGINAS`, desde el 08/10/2026). Crear el
archivo acá hace que la pantalla exista, pero **no la pone en el menú de nadie**:

1. Su descripción en `PANTALLAS`, en [`src/lib/navegacion.ts`](../lib/navegacion.ts). **El
   ícono no se toca**: está en `ICONOS_MENU` (mismo archivo) y la pantalla usa ese mismo. Los
   íconos del menú solo se cambian a pedido explícito (08/10/2026).
2. Su fila en **Administrador → Crear páginas** (menú principal, nombre y ruta). El número lo
   pone el sistema —el último del menú más 1— y la página queda **sin permisos**.
3. Los permisos en **Administrador → Roles de páginas**, también los de quien la creó: hasta
   este paso no le aparece a nadie en el menú.

Una ruta que ninguna página de `MENU_PAGINAS` controla se puede abrir escribiendo la URL
(la guarda de `AppShell` no la cierra). Inicio, Mi cuenta y las dos de administración no van en
la base: son fijas. Ver el [`README`](../../README.md) → *Módulos y menú*.
