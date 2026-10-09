import { createFileRoute } from "@tanstack/react-router";
import { Building } from "lucide-react";

import { InstitucionesAutoridad } from "@/components/instituciones-autoridad";
import { apiDirectoresInstitucion } from "@/lib/instituciones-directores";

export const Route = createFileRoute("/instituciones-directores/")({
  head: () => ({
    meta: [
      { title: "Instituciones y Directores — Juventud con Valores" },
      { name: "description", content: "Quién dirige cada institución, por período." },
    ],
  }),
  component: InstitucionesDirectoresPage,
});

/**
 * Instituciones y Directores: la página 36 de APEX (un IG de solo lectura
 * sobre `INSTITUCIONES_DIRECTORES`) y su modal 37 (Crear Institución y
 * Director), que acá es el diálogo de la pantalla con los permisos de la 36.
 * Backend: `backend/instituciones_directores.sql`, el mismo de la pestaña
 * Autoridades de la ficha de Instituciones; sin cambios. El ícono es el que ya
 * tenía en el menú (`Building`).
 */
function InstitucionesDirectoresPage() {
  return <InstitucionesAutoridad api={apiDirectoresInstitucion} icono={Building} />;
}
