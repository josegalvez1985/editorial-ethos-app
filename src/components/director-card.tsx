/**
 * La dirección de la institución elegida: quién la dirige, con cargo y teléfono.
 *
 * ── QUÉ ES Y QUÉ NO ES ───────────────────────────────────────────────────────
 *
 * **Es un dato informativo, no un campo del formulario.** No se elige, no se
 * edita y no se guarda: no hay `id_director` en `EVALUACIONES_FACILITADORES` ni
 * viaja en el JSON del POST/PUT. Está para que el evaluador sepa con quién
 * hablar al llegar a la institución.
 *
 * Por eso NO va dentro del `fieldset disabled` como los demás campos —no hay
 * nada que bloquear— y por eso un fallo al cargarlo nunca impide guardar.
 *
 * ── POR QUÉ SON VARIOS Y NO UNO ──────────────────────────────────────────────
 *
 * `INSTITUCIONES_DIRECTORES` tiene una fila por período + nivel + turno, así que
 * una institución puede tener a la vez un director de la mañana en Escolar
 * Básica y otro de la tarde en Media, los dos activos. Mostrar solo el primero
 * escondería al que sí corresponde, sin avisar. Se listan todos los activos y
 * decide quien mira.
 */

import { useQuery } from "@tanstack/react-query";
import { Loader2, Phone, UserRound } from "lucide-react";

import { listarDirectores, STALE_LISTAS, type Director } from "@/lib/evaluaciones";

/**
 * "Directora · Escolar Básica", con lo que haya cargado.
 *
 * Los tres son texto libre en la base y suelen venir incompletos: se omite lo
 * que falta en vez de dejar separadores sueltos.
 */
function subtitulo(d: Director) {
  return [d.cargo, d.nivel].filter(Boolean).join(" · ");
}

function Fila({ d }: { d: Director }) {
  const sub = subtitulo(d);

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[15px] leading-snug font-bold">{d.nombre_apellido}</span>
        {/*
          OJO: este turno es el VARCHAR2(50) de INSTITUCIONES_DIRECTORES, texto
          libre. NO es el 1/2/3 de POSTULACIONES.TURNO, así que `nombreTurno()`
          no aplica acá: se muestra tal como está cargado.
        */}
        {d.turno && (
          <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {d.turno}
          </span>
        )}
      </div>

      {sub && <p className="mt-0.5 text-[13px] text-muted-foreground">{sub}</p>}

      {d.nro_telefono && (
        /*
          `tel:` y no texto plano: el caso de uso es llamar a la institución desde
          el teléfono, parado en la puerta. Se abre el marcador con un toque.
        */
        <a
          href={`tel:${d.nro_telefono.replace(/\s+/g, "")}`}
          className="tap mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary"
        >
          <Phone className="size-3.5 shrink-0" />
          {d.nro_telefono}
        </a>
      )}
    </div>
  );
}

export function DirectorCard({ idInstitucion }: { idInstitucion: number | null }) {
  /*
   * El backend exige `id_institucion` y responde 400 sin él. Sin esta guarda,
   * abrir el formulario vacío dispararía una llamada fallida antes de que el
   * usuario elija nada.
   */
  const habilitada = idInstitucion != null;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["directores", idInstitucion],
    queryFn: () => listarDirectores(idInstitucion!),
    enabled: habilitada,
    staleTime: STALE_LISTAS,
  });

  // Antes de elegir institución no se muestra nada, igual que la postulación: un
  // "elegí primero…" suma ruido a un formulario que ya es largo.
  if (!habilitada) return null;

  /*
   * Sin directores cargados no se dibuja NADA. Es la diferencia con la
   * postulación, que ahí sí avisa: la postulación es algo que el usuario tiene
   * que elegir, y su ausencia le cambia lo que puede hacer. Esto es un dato de
   * contexto, y un cartel de "esta institución no tiene director cargado" sería
   * ruido sobre algo que el evaluador no puede resolver desde acá.
   */
  if (!isLoading && (isError || !data?.length)) return null;

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        {/* Plural solo cuando hay más de uno: "Dirección" con una fila sola se
            lee raro, y "Directores" con un director también. */}
        {data && data.length > 1 ? "Dirección de la institución" : "Director"}
      </label>

      <div className="rounded-xl border border-border/60 bg-muted/40 px-4 py-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Buscando la dirección…
          </div>
        ) : (
          <div className="flex items-start gap-2.5">
            <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1 space-y-3">
              {data!.map((d, i) => (
                <div
                  key={d.id_periodo}
                  // Separador entre personas, no arriba de la primera.
                  className={i > 0 ? "border-t border-border/60 pt-3" : undefined}
                >
                  <Fila d={d} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
