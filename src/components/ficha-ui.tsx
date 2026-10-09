import { X } from "lucide-react";
import type { ReactNode } from "react";

import { campo, type ValorLista } from "@/lib/utils";

/**
 * Piezas de las fichas grandes —una pantalla con secciones y un solo Guardar
 * al pie—: Facilitadores e Instituciones. Salieron de `facilitadores.$id.tsx`
 * el 09/10/2026, al hacer la ficha de Instituciones, para no repetirlas.
 */

export function Seccion({
  titulo,
  ayuda,
  children,
}: {
  titulo: string;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4 shadow-soft">
      <div>
        <h2 className="font-display text-lg font-bold">{titulo}</h2>
        {ayuda && <p className="text-[11.5px] text-muted-foreground">{ayuda}</p>}
      </div>
      {children}
    </section>
  );
}

/** La etiqueta de un campo, con el asterisco si es obligatorio. */
export function EtiquetaCampo({ texto, req }: { texto: string; req?: boolean }) {
  return (
    <span className="mb-1.5 block text-sm font-medium">
      {texto} {req && <span className="text-destructive">*</span>}
    </span>
  );
}

export function Texto({
  etiqueta,
  valor,
  onCambio,
  req,
  largo,
  tipo = "text",
  multilinea,
  mayusculas,
  inputMode,
  ayuda,
  placeholder,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  req?: boolean;
  largo?: number;
  tipo?: "text" | "date" | "time";
  multilinea?: boolean;
  mayusculas?: boolean;
  inputMode?: "numeric" | "decimal" | "tel" | "email";
  ayuda?: ReactNode;
  placeholder?: string;
}) {
  const cambio = (v: string) => onCambio(mayusculas ? v.toUpperCase() : v);
  return (
    <label className="block">
      <EtiquetaCampo texto={etiqueta} req={req} />
      {multilinea ? (
        <textarea
          value={valor}
          onChange={(e) => cambio(e.target.value)}
          maxLength={largo}
          rows={3}
          placeholder={placeholder}
          className={`${campo} h-auto py-2.5`}
        />
      ) : (
        <input
          type={tipo}
          value={valor}
          onChange={(e) => cambio(e.target.value)}
          maxLength={largo}
          inputMode={inputMode}
          autoComplete="off"
          placeholder={placeholder}
          className={campo}
        />
      )}
      {ayuda && <span className="mt-1 block text-[11px] text-muted-foreground">{ayuda}</span>}
    </label>
  );
}

/**
 * Una lista de APEX (SI_NO, estado civil…) como pastillas: se ve todo de un
 * vistazo y es un toque. Si no es obligatoria, tocar la elegida la quita. Un
 * valor guardado que la lista ya no tiene se muestra igual, para no perderlo.
 */
export function Pastillas({
  etiqueta,
  opciones,
  valor,
  onCambio,
  req,
}: {
  etiqueta: string;
  opciones: ValorLista[];
  valor: string;
  onCambio: (v: string) => void;
  req?: boolean;
}) {
  const todas =
    valor && !opciones.some((o) => o.valor === valor)
      ? [...opciones, { valor, mostrar: valor }]
      : opciones;
  return (
    <div role="radiogroup" aria-label={etiqueta}>
      <EtiquetaCampo texto={etiqueta} req={req} />
      <div className="flex flex-wrap gap-2">
        {todas.map((o) => {
          const activa = o.valor === valor;
          return (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={activa}
              onClick={() => onCambio(activa && !req ? "" : o.valor)}
              className={`tap h-10 rounded-xl border px-3.5 text-sm font-medium ${
                activa
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 bg-background hover:border-primary/40"
              }`}
            >
              {o.mostrar}
            </button>
          );
        })}
        {!todas.length && (
          <span className="text-xs text-muted-foreground">Sin valores cargados.</span>
        )}
      </div>
    </div>
  );
}

export function Quitar({ onClick, texto = "Quitar" }: { onClick: () => void; texto?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
    >
      <X className="size-3" />
      {texto}
    </button>
  );
}
