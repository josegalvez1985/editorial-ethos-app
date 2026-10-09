import { createFileRoute } from "@tanstack/react-router";
import { BriefcaseBusiness } from "lucide-react";

import { PersonasAutoridad } from "@/components/personas-autoridad";
import type { ApiPersonas } from "@/lib/autoridades";
import {
  eliminarDirector,
  guardarDirector,
  keysDirectoresAbm,
  listarDirectoresAbm,
} from "@/lib/directores";
import {
  keysDirectoresInstitucion,
  listarTodosDirectoresInstitucion,
} from "@/lib/instituciones-directores";

export const Route = createFileRoute("/directores/")({
  head: () => ({
    meta: [
      { title: "Directores — Juventud con Valores" },
      { name: "description", content: "Alta, modificación y baja de directores." },
    ],
  }),
  component: DirectoresPage,
});

/**
 * Directores: la página 34 de APEX (un IG sobre `DIRECTORES`) y su modal 35
 * (Crear Director), que acá es el diálogo de la pantalla con los permisos de
 * la 34. Backend: `backend/directores.sql`, el mismo que ya usaba la pestaña
 * Autoridades de la ficha de Instituciones para dar de alta directores; sin
 * cambios. Dónde figura cada uno sale de `instituciones-directores` (todas las
 * filas). El ícono es el que ya tenía en el menú (`BriefcaseBusiness`).
 */
const api: ApiPersonas = {
  textos: { titulo: "Directores", singular: "director", rol: "Cargo", verbo: "Dirige" },
  icono: BriefcaseBusiness,
  ruta: "/directores",
  key: keysDirectoresAbm.todo,
  listar: listarDirectoresAbm,
  guardar: guardarDirector,
  eliminar: eliminarDirector,
  asignaciones: {
    key: keysDirectoresInstitucion.todas,
    listar: listarTodosDirectoresInstitucion,
  },
  // La pestaña Autoridades de cada ficha muestra el nombre y la CI de la persona.
  relacionadas: [keysDirectoresInstitucion.todo],
};

function DirectoresPage() {
  return <PersonasAutoridad api={api} />;
}
