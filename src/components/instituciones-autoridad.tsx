import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ExternalLink, Phone, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Buscador, Cargando, Fallo } from "@/components/admin-ui";
import { AppShell } from "@/components/app-shell";
import { EditorAutoridad } from "@/components/autoridades-institucion";
import type { ApiAutoridades, Autoridad } from "@/lib/autoridades";
import { keysInstituciones, listarInstituciones, type InstitucionFila } from "@/lib/instituciones";
import { iniciales } from "@/lib/navegacion";
import { usePermisos } from "@/lib/permisos";
import { normalizar } from "@/lib/utils";

type Estado = "vigentes" | "sin" | "todas";

/** Una institución con sus filas (las que pasan los filtros). */
type Grupo = {
  inst: InstitucionFila | null;
  id: number;
  nombre: string;
  filas: Autoridad[];
  /** Sin ninguna vigente: la última que tuvo, para "Antes: …". */
  ultima?: Autoridad;
};

/** `tel:` y no texto plano: se llama con un toque. */
const telHref = (t: string) => `tel:${t.replace(/\s+/g, "")}`;

/** Activas primero; después el período más nuevo y el nombre. */
const ordenFilas = (a: Autoridad, b: Autoridad) =>
  Number(b.activo) - Number(a.activo) ||
  b.periodo.localeCompare(a.periodo) ||
  a.persona.localeCompare(b.persona, "es");

/**
 * La página de una tabla de autoridades por institución: Instituciones y
 * Directores (36 de APEX, con su modal 37) e Instituciones y
 * Coordinadores (47 y 48). Las dos son un IG de solo lectura de todas las
 * filas, con un modal de alta/edición: lo que cambia viene en `api` (ver
 * {@link ApiAutoridades}), como en `<PersonasAutoridad>`.
 *
 * Lo que agrega el sitio sobre APEX:
 *
 * - **Una tarjeta por institución** con sus autoridades adentro (cargo,
 *   nivel, turno, período y el teléfono para llamar con un toque). El IG
 *   mostraba una fila suelta por asignación, con los ids de las listas.
 * - **Vigentes / Sin … / Todas**: arranca en las vigentes (ESTADO 'A').
 *   "Sin director" son las instituciones activas que hoy no tienen ninguno,
 *   con el último que tuvieron; APEX no tenía cómo verlo.
 * - Pastillas por **período** y por **nivel**, y buscador por institución,
 *   ciudad, persona o CI.
 * - **El modal 37 es el mismo diálogo de la pestaña Autoridades de la ficha**,
 *   con la institución para elegir: persona de la lista o nueva ahí mismo,
 *   períodos sugeridos, cargo/nivel/turno en pastillas, borrar con
 *   confirmación. "Agregar" desde una tarjeta ya trae su institución.
 *
 * Permisos: los de esta página o modificar instituciones (la 16), igual que el
 * backend.
 */
export function InstitucionesAutoridad({
  api,
  icono: Icono,
}: {
  api: ApiAutoridades;
  icono: LucideIcon;
}) {
  const { puedeRuta } = usePermisos();
  const t = api.textos;
  const puedeAgregar = puedeRuta("/instituciones", "actualizar") || puedeRuta(api.ruta, "insertar");

  const todas = useQuery({ queryKey: api.todas.key, queryFn: api.todas.listar });
  const instituciones = useQuery({
    queryKey: keysInstituciones.lista,
    queryFn: listarInstituciones,
  });

  const [estado, setEstado] = useState<Estado>("vigentes");
  /** "" = todos. */
  const [periodo, setPeriodo] = useState("");
  const [nivel, setNivel] = useState("");
  const [buscar, setBuscar] = useState("");
  /** `null` cerrado; `fila: null` es un alta (con la institución propuesta, si hay). */
  const [abierto, setAbierto] = useState<{ fila: Autoridad | null; idInst: number | null } | null>(
    null,
  );

  const filas = todas.data ?? [];
  const insts = instituciones.data?.items ?? [];
  const porId = new Map(insts.map((i) => [i.id, i]));

  const porInst = new Map<number, Autoridad[]>();
  for (const f of filas) {
    const l = porInst.get(f.idInstitucion);
    if (l) l.push(f);
    else porInst.set(f.idInstitucion, [f]);
  }
  // Una inactiva sin autoridades no "falta": no se cuenta ni se lista.
  const sinVigente = insts.filter((i) => i.activa && !porInst.get(i.id)?.some((f) => f.activo));

  const base = estado === "vigentes" ? filas.filter((f) => f.activo) : filas;
  const periodos = [...new Set(base.map((f) => f.periodo).filter(Boolean))].sort().reverse();
  const periodoActivo = estado !== "sin" && periodos.includes(periodo) ? periodo : "";
  const conPeriodo = base.filter((f) => !periodoActivo || f.periodo === periodoActivo);
  const niveles = [...new Set(conPeriodo.map((f) => f.nivel).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
  const nivelActivo = estado !== "sin" && niveles.includes(nivel) ? nivel : "";

  const q = normalizar(buscar.trim());
  const coincide = (f: Autoridad) =>
    !q || normalizar(`${f.persona} ${f.personaCi} ${f.rol} ${f.nivel} ${f.turno}`).includes(q);
  const coincideInst = (id: number, nombre: string) =>
    !q || normalizar(`${nombre} ${porId.get(id)?.ciudad ?? ""}`).includes(q);

  let grupos: Grupo[];
  if (estado === "sin") {
    grupos = sinVigente
      .filter((i) => coincideInst(i.id, i.nombre))
      .map((i) => ({
        inst: i,
        id: i.id,
        nombre: i.nombre,
        filas: [],
        ultima: [...(porInst.get(i.id) ?? [])].sort(ordenFilas)[0],
      }));
  } else {
    const m = new Map<number, Autoridad[]>();
    for (const f of conPeriodo) {
      if (nivelActivo && f.nivel !== nivelActivo) continue;
      // Si coincide la institución, van todas sus filas; si no, las que coinciden.
      if (!coincideInst(f.idInstitucion, f.institucion) && !coincide(f)) continue;
      const l = m.get(f.idInstitucion);
      if (l) l.push(f);
      else m.set(f.idInstitucion, [f]);
    }
    grupos = [...m].map(([id, l]) => ({
      inst: porId.get(id) ?? null,
      id,
      nombre: porId.get(id)?.nombre ?? l[0].institucion,
      filas: l.sort(ordenFilas),
    }));
  }
  grupos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const conVigente = new Set(filas.filter((f) => f.activo).map((f) => f.idInstitucion)).size;
  const cuentas: Record<Estado, number> = {
    vigentes: conVigente,
    sin: sinVigente.length,
    todas: porInst.size,
  };
  const textosEstado: Record<Estado, string> = {
    vigentes: "Vigentes",
    sin: `Sin ${t.singular}`,
    todas: "Todas, con períodos anteriores",
  };

  const cargando = todas.isLoading || instituciones.isLoading;
  const error = todas.error ?? instituciones.error;

  return (
    <AppShell>
      <div className="px-5 pt-5 pb-24">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold">Instituciones y {t.titulo}</h1>
            <p className="text-xs text-muted-foreground">
              Quién {t.verbo.toLowerCase()} cada institución, por período, {t.rol.toLowerCase()},
              nivel y turno.
            </p>
          </div>
          {puedeAgregar && !cargando && !error && (
            <button
              type="button"
              onClick={() => setAbierto({ fila: null, idInst: null })}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft"
            >
              <Plus className="size-4" />
              <span className="hidden sm:inline">Asignar {t.singular}</span>
              <span className="sm:hidden">Asignar</span>
            </button>
          )}
        </div>

        {cargando ? (
          <Cargando />
        ) : error ? (
          <Fallo error={error} texto={`No se pudieron cargar los ${t.titulo.toLowerCase()}`} />
        ) : (
          <>
            <div className="mb-3 space-y-2">
              <div role="tablist" aria-label="Estado" className="flex flex-wrap gap-2">
                {(["vigentes", "sin", "todas"] as const).map((e) => (
                  <Pastilla
                    key={e}
                    activa={estado === e}
                    onClick={() => setEstado(e)}
                    cuenta={cuentas[e]}
                    alerta={e === "sin" && cuentas.sin > 0}
                  >
                    {textosEstado[e]}
                  </Pastilla>
                ))}
              </div>
              {estado !== "sin" && periodos.length > 1 && (
                <div role="tablist" aria-label="Período" className="flex flex-wrap gap-2">
                  {["", ...periodos.slice(0, 8)].map((p) => (
                    <Pastilla
                      key={p || "todos"}
                      chica
                      activa={periodoActivo === p}
                      onClick={() => setPeriodo(p)}
                    >
                      {p || "Todos los períodos"}
                    </Pastilla>
                  ))}
                </div>
              )}
              {estado !== "sin" && niveles.length > 1 && (
                <div role="tablist" aria-label="Nivel" className="flex flex-wrap gap-2">
                  {["", ...niveles].map((n) => (
                    <Pastilla
                      key={n || "todos"}
                      chica
                      activa={nivelActivo === n}
                      onClick={() => setNivel(n)}
                    >
                      {n || "Todos los niveles"}
                    </Pastilla>
                  ))}
                </div>
              )}
            </div>

            {(filas.length > 6 || insts.length > 6) && (
              <Buscador
                valor={buscar}
                onCambio={setBuscar}
                placeholder={`Buscar por institución, ciudad, ${t.singular} o CI…`}
              />
            )}

            {!grupos.length ? (
              <div className="py-12 text-center">
                <Icono className="mx-auto size-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">
                  {q
                    ? "Nada coincide con la búsqueda."
                    : estado === "sin"
                      ? `Todas las instituciones activas tienen ${t.singular} vigente.`
                      : `Todavía no hay ${t.titulo.toLowerCase()} asignados${estado === "vigentes" ? " vigentes" : ""}.`}
                </p>
                {!q && estado === "vigentes" && cuentas.sin > 0 && (
                  <button
                    type="button"
                    onClick={() => setEstado("sin")}
                    className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-primary-soft px-5 text-sm font-semibold text-primary"
                  >
                    Ver las {cuentas.sin} sin {t.singular}
                  </button>
                )}
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {grupos.map((g) => (
                  <li key={g.id}>
                    <Tarjeta
                      g={g}
                      api={api}
                      puedeAgregar={puedeAgregar}
                      onAbrir={(fila) => setAbierto({ fila, idInst: g.id })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {abierto && (
        <EditorAutoridad
          key={abierto.fila?.id ?? `nueva-${abierto.idInst ?? ""}`}
          api={api}
          idInstitucion={abierto.idInst}
          elegirInstitucion
          fila={abierto.fila}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </AppShell>
  );
}

function Pastilla({
  activa,
  onClick,
  cuenta,
  chica,
  alerta,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  cuenta?: number;
  chica?: boolean;
  alerta?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activa}
      onClick={onClick}
      className={`tap flex items-center gap-1.5 rounded-full border font-semibold ${
        chica ? "h-8 px-3 text-[12px]" : "h-9 px-3.5 text-[13px]"
      } ${
        activa
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
      {cuenta != null && (
        <span
          className={`rounded-full px-1.5 text-[11px] tabular-nums ${
            activa
              ? "bg-white/20"
              : alerta
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                : "bg-muted"
          }`}
        >
          {cuenta}
        </span>
      )}
    </button>
  );
}

function Tarjeta({
  g,
  api,
  puedeAgregar,
  onAbrir,
}: {
  g: Grupo;
  api: ApiAutoridades;
  puedeAgregar: boolean;
  onAbrir: (fila: Autoridad | null) => void;
}) {
  const t = api.textos;
  const inactiva = g.inst != null && !g.inst.activa;
  return (
    <div className="flex h-full flex-col rounded-2xl border border-border/60 bg-card shadow-soft">
      <div className="flex items-start gap-2 px-3.5 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm font-bold">
            {g.nombre}
            {inactiva && (
              <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
                Inactiva
              </span>
            )}
          </p>
          {g.inst?.ciudad && <p className="text-[11.5px] text-muted-foreground">{g.inst.ciudad}</p>}
        </div>
        <Link
          to="/instituciones/$id"
          params={{ id: String(g.id) }}
          search={{ tab: "autoridades" }}
          aria-label={`Abrir la ficha de ${g.nombre}`}
          title="Abrir la ficha"
          className="tap grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ExternalLink className="size-4" />
        </Link>
      </div>

      {g.filas.length ? (
        <ul className="flex-1 divide-y divide-border/50 border-t border-border/50">
          {g.filas.map((a) => (
            <li key={a.id}>
              <Fila a={a} singular={t.singular} onAbrir={() => onAbrir(a)} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mx-3.5 flex-1 rounded-xl bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="size-3.5" />
            Sin {t.singular} vigente
          </p>
          {g.ultima && (
            <p className="mt-0.5 text-amber-700/80 dark:text-amber-400/80">
              Antes: {g.ultima.persona || `sin ${t.singular}`}
              {g.ultima.periodo ? ` (${g.ultima.periodo})` : ""}
            </p>
          )}
        </div>
      )}

      {puedeAgregar && (
        <button
          type="button"
          onClick={() => onAbrir(null)}
          className="tap mx-3.5 my-3 flex h-9 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-[13px] font-semibold text-primary hover:border-primary/40"
        >
          <Plus className="size-4" />
          {g.filas.length ? "Agregar" : "Asignar"} {t.singular}
        </button>
      )}
    </div>
  );
}

function Fila({ a, singular, onAbrir }: { a: Autoridad; singular: string; onAbrir: () => void }) {
  const detalle = [a.rol, a.nivel, a.turno].filter(Boolean).join(" · ");
  const telefono = a.telefono || a.personaTelefono;
  return (
    <div className="flex items-center gap-1 pr-2">
      <button
        type="button"
        onClick={onAbrir}
        className="tap flex min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 text-left hover:bg-muted/40"
      >
        <span
          aria-hidden
          className={`grid size-9 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
            a.activo ? "bg-hero-gradient text-on-brand" : "bg-muted text-muted-foreground"
          }`}
        >
          {iniciales(a.persona || "?")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5">
            <span className="truncate text-[13px] font-semibold">
              {a.persona || `Sin ${singular}`}
            </span>
            {!a.activo && (
              <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold text-muted-foreground">
                Inactivo
              </span>
            )}
          </span>
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {[detalle, a.periodo && `Período ${a.periodo}`].filter(Boolean).join(" — ") ||
              "Sin datos"}
          </span>
        </span>
      </button>
      {telefono && (
        <a
          href={telHref(telefono)}
          aria-label={`Llamar a ${a.persona || singular}: ${telefono}`}
          title={telefono}
          className="tap grid size-9 shrink-0 place-items-center rounded-full text-primary hover:bg-primary-soft"
        >
          <Phone className="size-4" />
        </a>
      )}
    </div>
  );
}
