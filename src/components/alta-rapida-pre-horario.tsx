import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Texto } from "@/components/ficha-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { guardarDocente, keysDocentes } from "@/lib/docentes";
import { guardarMateria, keysMaterias } from "@/lib/materias";
import { keysPreHorarios, type OpcionesPreHorario } from "@/lib/pre-horarios";
import { normalizar } from "@/lib/utils";

/** Lo que se está dando de alta y cómo elegirlo en la fila al terminar. */
export type AltaPendiente = { tipo: "materia" | "docente"; elegir: (valor: string) => void };

/**
 * Alta rápida de una materia o un docente sin salir de Pre-horarios
 * (22/10/2026, pedido de Jose): la opción "+ Nueva materia…" / "+ Nuevo
 * docente…" de la lista abre esto y, al guardarlo, queda elegido en la fila.
 * Usa los mismos endpoints que `/materias` y `/docentes` (sin backend nuevo) y
 * se ofrece solo a quien puede insertar en esas pantallas.
 *
 * Si lo escrito ya existe (mismo nombre, sin importar tildes ni mayúsculas),
 * avisa y ofrece usar el que está, para no duplicar.
 */
export function AltaRapidaPreHorario({
  alta,
  op,
  onCerrar,
}: {
  alta: AltaPendiente;
  op: OpcionesPreHorario;
  onCerrar: () => void;
}) {
  const qc = useQueryClient();
  const esDocente = alta.tipo === "docente";
  const [nombre, setNombre] = useState("");
  const [ci, setCi] = useState("");
  const [telefono, setTelefono] = useState("");

  const limpio = (v: string) => v.trim().replace(/\s+/g, " ");
  const n = limpio(nombre);
  const existente = n
    ? (esDocente ? op.docentes : op.materias).find((x) => normalizar(x.nombre) === normalizar(n))
    : undefined;

  const usar = (id: number) => {
    alta.elegir(String(id));
    onCerrar();
  };

  const guardar = useMutation({
    mutationFn: async () => {
      const id = esDocente
        ? await guardarDocente(null, {
            nombre: n,
            ci: limpio(ci),
            telefono: limpio(telefono),
            activo: true,
          })
        : await guardarMateria(null, n);
      // La lista de la fila primero, así la celda ya muestra el nombre (y el
      // docente trae su teléfono) al elegirlo.
      await Promise.all([
        qc.invalidateQueries({ queryKey: keysPreHorarios.opciones }),
        qc.invalidateQueries({ queryKey: esDocente ? keysDocentes.todo : keysMaterias.todo }),
      ]);
      return id;
    },
    onSuccess: (id) => {
      toast.success(`"${n}" agregado y elegido en la fila`);
      usar(id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo guardar"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !guardar.isPending && onCerrar()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-xl">
            {esDocente ? "Nuevo docente" : "Nueva materia"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {esDocente
              ? "Se suma a la lista de docentes y queda elegido en esta fila."
              : "Se suma a la lista de materias y queda elegida en esta fila."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (n && !guardar.isPending) guardar.mutate();
          }}
          className="space-y-4"
        >
          <fieldset disabled={guardar.isPending} className="space-y-4">
            <div>
              <Texto
                etiqueta={esDocente ? "Nombre y apellido" : "Nombre de la materia"}
                req
                largo={esDocente ? 500 : 200}
                valor={nombre}
                onCambio={setNombre}
                placeholder={esDocente ? "Ej.: María González" : "Ej.: Ética"}
              />
              {existente && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Ya existe "{existente.nombre}".{" "}
                  <button
                    type="button"
                    onClick={() => usar(existente.id)}
                    className="font-semibold text-primary underline"
                  >
                    Usar {esDocente ? "ese" : "esa"}
                  </button>
                </p>
              )}
            </div>
            {esDocente && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Texto
                  etiqueta="Nro. CI"
                  largo={100}
                  inputMode="numeric"
                  valor={ci}
                  onCambio={setCi}
                />
                <Texto
                  etiqueta="Nro. teléfono"
                  largo={100}
                  inputMode="tel"
                  valor={telefono}
                  onCambio={setTelefono}
                  ayuda="Se pone en el celular de la fila."
                />
              </div>
            )}
          </fieldset>

          <button
            type="submit"
            disabled={!n || guardar.isPending}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-soft disabled:opacity-50"
          >
            {guardar.isPending && <Loader2 className="size-4 animate-spin" />}
            Agregar y elegir
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
