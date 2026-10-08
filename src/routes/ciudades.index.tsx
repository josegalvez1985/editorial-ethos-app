import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";

import { CatalogoNombre } from "@/components/catalogo-nombre";
import { apiCiudades } from "@/lib/ciudades";
import { apiDepartamentos } from "@/lib/departamentos";

export const Route = createFileRoute("/ciudades/")({
  head: () => ({
    meta: [
      { title: "Ciudades — Juventud con Valores" },
      { name: "description", content: "Alta, modificación y baja de ciudades." },
    ],
  }),
  component: CiudadesPage,
});

/**
 * Ciudades: la página 8 de APEX (un IG sobre `CIUDADES`) y su modal 9 (Crear
 * Ciudad), que acá es el diálogo de la pantalla con los permisos de la 8.
 *
 * El backend es suyo, `backend/ciudades.sql` (con `lib/ciudades.ts`); la
 * pantalla es `<CatalogoNombre>` con el departamento como `padre`: filtro y
 * grupos por departamento. El país no se elige: sale del departamento.
 */
function CiudadesPage() {
  return (
    <CatalogoNombre
      api={apiCiudades}
      ruta="/ciudades"
      icon={Building2}
      padre={{ etiqueta: "Departamento", plural: "departamentos", api: apiDepartamentos }}
      textos={{
        titulo: "Ciudades",
        descripcion: "Las ciudades de cada departamento. El país sale del departamento.",
        singular: "ciudad",
        plural: "ciudades",
        femenino: true,
        ejemplo: "San Lorenzo",
      }}
    />
  );
}
