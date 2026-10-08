import { createFileRoute } from "@tanstack/react-router";
import { Map as MapIcon } from "lucide-react";

import { CatalogoNombre } from "@/components/catalogo-nombre";
import { apiDepartamentos } from "@/lib/departamentos";
import { apiPaises } from "@/lib/paises";

export const Route = createFileRoute("/departamentos/")({
  head: () => ({
    meta: [
      { title: "Departamentos — Juventud con Valores" },
      { name: "description", content: "Alta, modificación y baja de departamentos." },
    ],
  }),
  component: DepartamentosPage,
});

/**
 * Departamentos: la página 6 de APEX (un IG sobre `DEPARTAMENTOS`) y su modal
 * 7 (Crear Departamento), que acá es el diálogo de la pantalla con los
 * permisos de la 6.
 *
 * El backend es suyo, `backend/departamentos.sql` (con `lib/departamentos.ts`);
 * la pantalla es `<CatalogoNombre>` con el país como `padre`: filtro y grupos
 * por país, y el país se elige en el diálogo.
 */
function DepartamentosPage() {
  return (
    <CatalogoNombre
      api={apiDepartamentos}
      ruta="/departamentos"
      icon={MapIcon}
      padre={{ etiqueta: "País", plural: "países", api: apiPaises }}
      textos={{
        titulo: "Departamentos",
        descripcion: "Los departamentos de cada país.",
        singular: "departamento",
        plural: "departamentos",
        ejemplo: "Central",
      }}
    />
  );
}
