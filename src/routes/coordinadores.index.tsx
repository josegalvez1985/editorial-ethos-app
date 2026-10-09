import { createFileRoute } from "@tanstack/react-router";
import { UsersRound } from "lucide-react";

import { PersonasAutoridad } from "@/components/personas-autoridad";
import type { ApiPersonas } from "@/lib/autoridades";
import {
  eliminarCoordinador,
  guardarCoordinador,
  keysCoordinadores,
  listarCoordinadores,
} from "@/lib/coordinadores";
import {
  keysCoordinadoresInstitucion,
  listarTodosCoordinadoresInstitucion,
} from "@/lib/instituciones-coordinadores";

export const Route = createFileRoute("/coordinadores/")({
  head: () => ({
    meta: [
      { title: "Coordinadores — Juventud con Valores" },
      { name: "description", content: "Alta, modificación y baja de coordinadores." },
    ],
  }),
  component: CoordinadoresPage,
});

/**
 * Coordinadores: la página 45 de APEX (un IG sobre `COORDINADORES`) y su modal
 * 46 (Crear Coordinador), que acá es el diálogo de la pantalla con los
 * permisos de la 45. Es la misma pantalla que Directores (`<PersonasAutoridad>`)
 * con su api. Backend: `backend/coordinadores.sql`, el mismo que ya usaba la
 * pestaña Autoridades de la ficha de Instituciones para dar de alta
 * coordinadores; sin cambios. Dónde figura cada uno sale de
 * `instituciones-coordinadores` (todas las filas). El ícono es el que ya tenía
 * en el menú (`UsersRound`).
 */
const api: ApiPersonas = {
  textos: { titulo: "Coordinadores", singular: "coordinador", rol: "Tipo", verbo: "Coordina" },
  icono: UsersRound,
  ruta: "/coordinadores",
  key: keysCoordinadores.todo,
  listar: listarCoordinadores,
  guardar: guardarCoordinador,
  eliminar: eliminarCoordinador,
  asignaciones: {
    key: keysCoordinadoresInstitucion.todas,
    listar: listarTodosCoordinadoresInstitucion,
  },
  // La pestaña Autoridades de cada ficha muestra el nombre y la CI de la persona.
  relacionadas: [keysCoordinadoresInstitucion.todo],
};

function CoordinadoresPage() {
  return <PersonasAutoridad api={api} />;
}
