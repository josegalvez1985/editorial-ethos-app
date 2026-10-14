import { useQuery } from "@tanstack/react-query";
import { Cake, PartyPopper, X } from "lucide-react";
import { useState, type CSSProperties } from "react";

import {
  cumplenHoy,
  keysFacilitadores,
  listarFacilitadores,
  type CumpleHoy,
} from "@/lib/facilitadores";
import { hoyISO } from "@/lib/fechas";
import { iniciales } from "@/lib/navegacion";
import { useSession } from "@/lib/session";

/**
 * La tarjeta de cumpleaños del Inicio (14/10/2026): felicita a los
 * facilitadores ACTIVOS que cumplen años hoy. Sale de `fecha_nacimiento` del
 * listado de facilitadores (`GET facilitadores`), con la misma caché que la
 * pantalla de Facilitadores: no hay SQL propio.
 *
 * - **Uno solo:** "¡Feliz cumpleaños, María!" con los años que cumple.
 * - **Varios:** "¡Hoy cumplen años 3 facilitadores!" y una pastilla por cada uno.
 * - **Si el cumpleañero es quien entró** (su `USUARIO` es el de la sesión), el
 *   mensaje le habla a él: "Hoy es tu día".
 * - **Se puede cerrar por hoy:** la X la esconde hasta mañana
 *   (`ethos-cumple-cerrado` en `localStorage`, con la fecha).
 * - Sin cumpleaños hoy, o si la consulta falla, no ocupa lugar.
 */
export function Cumpleanios() {
  const { sesion } = useSession();
  const hoy = hoyISO();
  const [cerrado, setCerrado] = useState(() => leerCerrado() === hoy);

  const { data } = useQuery({
    queryKey: keysFacilitadores.lista,
    queryFn: listarFacilitadores,
    // Los cumpleaños cambian una vez por día: no hace falta pedirlo en cada vuelta al Inicio.
    staleTime: 30 * 60 * 1000,
  });

  const cumplen = data ? cumplenHoy(data) : [];
  if (cerrado || !cumplen.length) return null;

  const yo = sesion?.usuario?.toUpperCase();
  const esMio = (f: CumpleHoy) => !!yo && f.usuario.toUpperCase() === yo;
  const uno = cumplen.length === 1 ? cumplen[0] : null;
  const mio = uno && esMio(uno);

  const cerrar = () => {
    guardarCerrado(hoy);
    setCerrado(true);
  };

  return (
    <section
      aria-label="Cumpleaños de hoy"
      className="relative mb-2 overflow-hidden rounded-2xl bg-hero-gradient p-5 text-on-brand shadow-elegant sm:p-6"
    >
      {/* Decoración: la torta de fondo y el confeti. */}
      <Cake
        aria-hidden
        className="pointer-events-none absolute -right-6 -bottom-8 size-40 rotate-12 text-white/10 sm:size-48"
      />
      <Confeti />

      <button
        type="button"
        onClick={cerrar}
        aria-label="Ocultar hasta mañana"
        title="Ocultar hasta mañana"
        className="absolute top-2.5 right-2.5 z-10 grid size-8 place-items-center rounded-full text-on-brand/70 hover:bg-white/15 hover:text-on-brand"
      >
        <X className="size-4" />
      </button>

      <div className="relative flex items-center gap-4 pr-6">
        {uno ? (
          <Avatar nombre={uno.nombre} grande />
        ) : (
          <span
            aria-hidden
            className="grid size-16 shrink-0 place-items-center rounded-full bg-white/15 ring-2 ring-white/40 sm:size-[4.5rem]"
          >
            <PartyPopper className="size-8" />
          </span>
        )}

        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-on-brand/75 uppercase">
            <PartyPopper className="size-3.5" />
            {mio ? "Hoy es tu día" : "Cumpleaños de hoy"}
          </p>
          <h2 className="font-display mt-1 text-[1.6rem] leading-tight font-bold sm:text-3xl">
            {uno
              ? `¡Feliz cumpleaños, ${primerNombre(uno.nombre)}!`
              : `¡Hoy cumplen años ${cumplen.length} facilitadores!`}
          </h2>
          <p className="mt-1.5 max-w-xl text-sm leading-snug text-on-brand/85">
            {uno
              ? mio
                ? `Toda la familia de Juventud con Valores celebra ${textoAnios(uno.cumple, "tus")} y te desea un año lleno de bendiciones.`
                : `${nombrePropio(uno.nombre)} ${uno.cumple > 0 && edadCreible(uno.cumple) ? `cumple ${uno.cumple} años hoy` : "está de cumpleaños"}. ¡Saludalo y hacé que su día sea especial!`
              : "Saludalos y hacé que su día sea especial. Toda la familia de Juventud con Valores les desea un año lleno de bendiciones."}
          </p>
        </div>
      </div>

      {!uno && (
        <ul className="relative mt-4 flex flex-wrap gap-2">
          {cumplen.map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-2 rounded-full bg-white/15 py-1 pr-3.5 pl-1 ring-1 ring-white/25 backdrop-blur-sm"
            >
              <Avatar nombre={f.nombre} />
              <span className="text-[13px] leading-tight font-semibold">
                {nombrePropio(f.nombre)}
                {esMio(f) && <span className="font-normal text-on-brand/75"> (vos)</span>}
                {edadCreible(f.cumple) && (
                  <span className="block text-[11px] font-normal text-on-brand/75">
                    {f.cumple} años
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Avatar({ nombre, grande }: { nombre: string; grande?: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative grid shrink-0 place-items-center rounded-full bg-white/15 font-semibold ring-white/40 ${
        grande ? "size-16 text-xl ring-2 sm:size-[4.5rem] sm:text-2xl" : "size-8 text-[11px] ring-1"
      }`}
    >
      {iniciales(nombre)}
      {grande && (
        <span className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full bg-white text-primary shadow-soft">
          <Cake className="size-4" />
        </span>
      )}
    </span>
  );
}

/*
 * El confeti: papelitos fijos (no al azar, para que no salten entre renders)
 * con los colores del logo y un dorado. Solo decoración.
 */
const PAPELITOS: { x: string; y: string; w: number; h: number; c: string; g: number; d: number }[] =
  [
    { x: "62%", y: "12%", w: 6, h: 10, c: "#e41420", g: 20, d: 0 },
    { x: "74%", y: "30%", w: 5, h: 5, c: "#ffffff", g: 0, d: 1.2 },
    { x: "83%", y: "10%", w: 7, h: 4, c: "#f5c542", g: -30, d: 0.6 },
    { x: "92%", y: "38%", w: 5, h: 9, c: "#7095cc", g: 45, d: 2.1 },
    { x: "56%", y: "78%", w: 6, h: 6, c: "#f5c542", g: 0, d: 1.6 },
    { x: "70%", y: "64%", w: 4, h: 8, c: "#ffffff", g: -15, d: 0.3 },
    { x: "88%", y: "72%", w: 7, h: 4, c: "#e41420", g: 60, d: 2.6 },
    { x: "46%", y: "8%", w: 4, h: 4, c: "#7095cc", g: 0, d: 3.1 },
    { x: "96%", y: "16%", w: 4, h: 7, c: "#f5c542", g: 10, d: 1.9 },
    { x: "40%", y: "88%", w: 5, h: 3, c: "#ffffff", g: -40, d: 0.9 },
  ];

function Confeti() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {PAPELITOS.map((p, i) => (
        <span
          key={i}
          className="absolute animate-confeti rounded-[2px] opacity-80"
          style={
            {
              left: p.x,
              top: p.y,
              width: p.w,
              height: p.h,
              backgroundColor: p.c,
              borderRadius: p.w === p.h ? "9999px" : undefined,
              animationDelay: `${p.d}s`,
              "--giro": `${p.g}deg`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

/** Una edad que no sale de una fecha mal cargada. */
const edadCreible = (n: number) => n >= 14 && n <= 100;

/** "tus 28 años", o "tu cumpleaños" si la edad no es creíble. */
const textoAnios = (n: number, pos: string) =>
  edadCreible(n) ? `${pos} ${n} años` : `${pos.replace(/s$/, "")} cumpleaños`;

/** "MARÍA JOSÉ LÓPEZ" → "María José López"; lo que ya viene con mayúsculas y minúsculas, igual. */
function nombrePropio(nombre: string): string {
  const limpio = nombre.trim().replace(/\s+/g, " ");
  if (limpio !== limpio.toUpperCase()) return limpio;
  return limpio.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}

const primerNombre = (nombre: string) => nombrePropio(nombre).split(" ")[0] || nombre;

/* La X cierra por hoy: se guarda la fecha. Sin storage, se cierra igual hasta recargar. */
const CLAVE_CERRADO = "ethos-cumple-cerrado";

function leerCerrado(): string {
  try {
    return localStorage.getItem(CLAVE_CERRADO) ?? "";
  } catch {
    return "";
  }
}

function guardarCerrado(dia: string) {
  try {
    localStorage.setItem(CLAVE_CERRADO, dia);
  } catch {
    /* sin storage: queda cerrada hasta recargar */
  }
}
