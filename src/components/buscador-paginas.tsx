import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Search, X } from "lucide-react";
import { useState } from "react";

import { useMenu, type ItemNav } from "@/lib/navegacion";
import { cn, normalizar } from "@/lib/utils";

type Resultado = ItemNav & { grupo: string };

/**
 * El buscador de páginas del inicio (24/11/2026, pedido de Jose).
 *
 * Busca entre las páginas del menú **que el usuario ve** (`useMenu`, las mismas
 * de la sidebar y de la hoja "Menú"): por el nombre, la descripción y el menú
 * principal, sin importar mayúsculas ni tildes. Cada palabra tiene que estar en
 * alguna parte ("pagos facil" encuentra "Pagos de facilitadores").
 *
 * Teclado: flechas para moverse, Enter abre la marcada (la primera si no se
 * movió), Escape limpia. Sin texto no muestra nada: el inicio queda igual.
 */
export function BuscadorPaginas() {
  const { menu } = useMenu();
  const navigate = useNavigate();
  const [texto, setTexto] = useState("");
  const [marcado, setMarcado] = useState(0);

  const palabras = normalizar(texto).toLowerCase().split(/\s+/).filter(Boolean);
  const resultados: Resultado[] = palabras.length
    ? menu
        .flatMap((g) => g.items.map((i) => ({ ...i, grupo: g.titulo ?? "" })))
        .filter((i) => i.to !== "/home")
        .map((i) => {
          const nombre = normalizar(i.label).toLowerCase();
          const todo = `${nombre} ${normalizar(`${i.descripcion ?? ""} ${i.grupo}`).toLowerCase()}`;
          if (!palabras.every((p) => todo.includes(p))) return null;
          // Primero las que empiezan con lo escrito, después las que lo tienen en
          // el nombre, al final las que solo lo tienen en la descripción o el menú.
          const orden = nombre.startsWith(palabras[0])
            ? 0
            : palabras.every((p) => nombre.includes(p))
              ? 1
              : 2;
          return { i, orden };
        })
        .filter((r): r is { i: Resultado; orden: number } => r !== null)
        .sort((a, b) => a.orden - b.orden || a.i.label.localeCompare(b.i.label, "es"))
        .map((r) => r.i)
    : [];
  const activo = Math.min(marcado, Math.max(resultados.length - 1, 0));

  const cambiar = (v: string) => {
    setTexto(v);
    setMarcado(0);
  };

  return (
    <div className="mb-5">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={texto}
          onChange={(e) => cambiar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && resultados.length) {
              e.preventDefault();
              setMarcado((activo + 1) % resultados.length);
            } else if (e.key === "ArrowUp" && resultados.length) {
              e.preventDefault();
              setMarcado((activo - 1 + resultados.length) % resultados.length);
            } else if (e.key === "Enter" && resultados[activo]) {
              e.preventDefault();
              void navigate({ to: resultados[activo].to });
            } else if (e.key === "Escape") {
              cambiar("");
            }
          }}
          placeholder="Buscar una página o formulario…"
          aria-label="Buscar una página o formulario"
          enterKeyHint="go"
          autoComplete="off"
          className="h-12 w-full rounded-2xl border border-input bg-card pr-11 pl-10 text-base shadow-soft outline-none focus:border-primary/50 [&::-webkit-search-cancel-button]:hidden"
        />
        {texto && (
          <button
            type="button"
            onClick={() => cambiar("")}
            aria-label="Limpiar búsqueda"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {palabras.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-2xl border border-border/60 bg-card shadow-soft">
          {resultados.length === 0 ? (
            <p className="px-4 py-5 text-center text-sm text-muted-foreground">
              Ninguna página coincide con “{texto.trim()}”.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-border/60 overflow-y-auto">
              {resultados.map((r, n) => {
                const Icono = r.icon;
                return (
                  <li key={r.to}>
                    <Link
                      to={r.to}
                      onMouseEnter={() => setMarcado(n)}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 transition-colors",
                        n === activo ? "bg-primary-soft" : "hover:bg-muted/60",
                      )}
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                        <Icono className="size-4.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{r.label}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">
                          {[r.grupo, r.descripcion].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
