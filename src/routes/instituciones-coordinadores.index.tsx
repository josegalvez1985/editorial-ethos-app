import { createFileRoute } from "@tanstack/react-router";
import { Landmark } from "lucide-react";

import { InstitucionesAutoridad } from "@/components/instituciones-autoridad";
import { apiCoordinadoresInstitucion } from "@/lib/instituciones-coordinadores";

export const Route = createFileRoute("/instituciones-coordinadores/")({
  head: () => ({
    meta: [
      { title: "Instituciones y Coordinadores — Juventud con Valores" },
      { name: "description", content: "Quién coordina en cada institución, por período." },
    ],
  }),
  component: InstitucionesCoordinadoresPage,
});

/**
 * Instituciones y Coordinadores: la página 47 de APEX (un IG de solo lectura
 * sobre `INSTITUCIONES_COORDNADORES`) y su modal 48 (Crear Instituciones y
 * Coordinadores), que acá es el diálogo de la pantalla con los permisos de la
 * 47. Es la misma pantalla que Instituciones y Directores
 * (`<InstitucionesAutoridad>`) con su api. Backend:
 * `backend/instituciones_coordinadores.sql`, el mismo de la pestaña
 * Autoridades de la ficha; sin cambios. El ícono es el que ya tenía en el menú
 * (`Landmark`).
 *
 * El modal 48 pedía solo institución, coordinador y tipo; el diálogo pide
 * además período y estado (propone el año y "Activo"), como la ficha: sin
 * estado una fila nunca cuenta como vigente.
 */
function InstitucionesCoordinadoresPage() {
  return <InstitucionesAutoridad api={apiCoordinadoresInstitucion} icono={Landmark} />;
}
