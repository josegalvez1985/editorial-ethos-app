import { PERIODOS, rangoDe, rangoValido, type Periodo, type Rango } from "@/lib/periodos";

/*
 * El selector del período de los reportes por fechas (páginas 53, 55 y 58): ver
 * `lib/periodos.ts`.
 */

const ddmmyyyy = (f: string) => f.split("-").reverse().join("/");

export function SelectorPeriodo({
  periodo,
  otro,
  onPeriodo,
  onOtro,
}: {
  periodo: Periodo;
  otro: Rango;
  onPeriodo: (p: Periodo) => void;
  onOtro: (r: Rango) => void;
}) {
  const rango = rangoDe(periodo, otro);
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Período" className="flex flex-wrap gap-2">
        {PERIODOS.map((p) => (
          <button
            key={p.clave}
            type="button"
            role="tab"
            aria-selected={periodo === p.clave}
            onClick={() => onPeriodo(p.clave)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${
              periodo === p.clave
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/80 bg-card hover:border-primary/40"
            }`}
          >
            {p.texto}
          </button>
        ))}
      </div>
      {periodo === "otro" ? (
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Fecha desde</span>
            <input
              type="date"
              value={otro.desde}
              onChange={(e) => onOtro({ ...otro, desde: e.target.value })}
              className="h-11 w-full rounded-xl border border-input bg-background px-3"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Fecha hasta</span>
            <input
              type="date"
              value={otro.hasta}
              onChange={(e) => onOtro({ ...otro, hasta: e.target.value })}
              className="h-11 w-full rounded-xl border border-input bg-background px-3"
            />
          </label>
          {!rangoValido(otro) && (
            <p className="col-span-2 text-xs text-destructive">
              Elegí un período válido, de hasta un año.
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Del {ddmmyyyy(rango.desde)} al {ddmmyyyy(rango.hasta)}
        </p>
      )}
    </div>
  );
}
