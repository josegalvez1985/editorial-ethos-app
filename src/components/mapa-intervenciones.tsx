import "leaflet/dist/leaflet.css";

import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";

import { esc } from "@/lib/mapa-intervenciones";

/**
 * El mapa de `/mapa-intervenciones` (Leaflet + OpenStreetMap, lo mismo que
 * usaba la página 25 de APEX). Solo dibuja: qué pines, qué líneas y qué
 * institución lo decide la pantalla.
 *
 * - Leaflet toca `window` al importarse: se carga dentro del efecto, nunca en
 *   el prerender.
 * - Los pines son `divIcon` (HTML), sin las imágenes por defecto de Leaflet,
 *   que con Vite pierden la ruta.
 * - Todo texto que va a un popup se escapa: la observación la escribe el
 *   facilitador.
 */

/** Varias marcaciones en el mismo lugar (a pocos metros): un solo pin. */
export type GrupoPin = {
  clave: string;
  lat: number;
  lng: number;
  /** En orden de hora. `n` es el número que se ve en la lista. */
  puntos: { id: number; n: number; lejos: boolean; html: string }[];
};

export type InstitucionPin = { id: number; nombre: string; lat: number; lng: number };

/** Un recorrido: los puntos de un día, en orden. */
export type Recorrido = { clave: string; coords: [number, number][] };

const AZUL = "#27306a";
const AMBAR = "#d97706";
const GRIS = "#475569";
/** Asunción, como APEX. */
const CENTRO: [number, number] = [-25.2819, -57.635];

export function MapaIntervenciones({
  grupos,
  instituciones,
  recorridos,
  seleccionado,
  onSeleccionar,
  className,
}: {
  grupos: GrupoPin[];
  instituciones: InstitucionPin[];
  recorridos: Recorrido[];
  /** El id de la marcación elegida en la lista: el mapa vuela hasta ella. */
  seleccionado: number | null;
  onSeleccionar: (id: number) => void;
  className?: string;
}) {
  const div = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const mapa = useRef<Leaflet.Map | null>(null);
  const capa = useRef<Leaflet.LayerGroup | null>(null);
  const porId = useRef(new Map<number, Leaflet.Marker>());
  const listo = useRef<Promise<void> | null>(null);
  const onSel = useRef(onSeleccionar);
  onSel.current = onSeleccionar;

  // Una sola vez: el mapa y los azulejos de OpenStreetMap.
  useEffect(() => {
    let cancelado = false;
    let observador: ResizeObserver | null = null;
    listo.current = (async () => {
      const mod = await import("leaflet");
      if (cancelado || !div.current) return;
      L.current = mod;
      const m = mod.map(div.current, { zoomControl: true }).setView(CENTRO, 6);
      mod
        .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
        })
        .addTo(m);
      capa.current = mod.layerGroup().addTo(m);
      mapa.current = m;
      // El contenedor cambia de alto con la pantalla (celular / escritorio).
      observador = new ResizeObserver(() => m.invalidateSize());
      observador.observe(div.current);
    })();
    return () => {
      cancelado = true;
      observador?.disconnect();
      mapa.current?.remove();
      mapa.current = null;
    };
  }, []);

  // Cada vez que cambian los datos: se borra todo y se vuelve a dibujar (APEX
  // los iba sumando encima de los anteriores).
  useEffect(() => {
    let vivo = true;
    void listo.current?.then(() => {
      const mod = L.current;
      const m = mapa.current;
      const c = capa.current;
      if (!vivo || !mod || !m || !c) return;
      c.clearLayers();
      porId.current.clear();
      const limites: [number, number][] = [];

      for (const r of recorridos) {
        if (r.coords.length < 2) continue;
        mod
          .polyline(r.coords, { color: AZUL, weight: 3, opacity: 0.55, dashArray: "6 6" })
          .addTo(c);
      }

      for (const i of instituciones) {
        mod
          .marker([i.lat, i.lng], {
            icon: mod.divIcon({
              className: "",
              iconSize: [30, 30],
              iconAnchor: [15, 15],
              html: `<div style="width:30px;height:30px;border-radius:8px;background:${GRIS};color:#fff;display:grid;place-items:center;box-shadow:0 1px 4px rgba(0,0,0,.35);border:2px solid #fff"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 22v-4a2 2 0 1 0-4 0v4"/><path d="m18 10 3.447 1.724a1 1 0 0 1 .553.894V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7.382a1 1 0 0 1 .553-.894L6 10"/><path d="M18 5v17"/><path d="m4 6 7.106-3.553a2 2 0 0 1 1.788 0L20 6"/><path d="M6 5v17"/><circle cx="12" cy="9" r="2"/></svg></div>`,
            }),
            zIndexOffset: -500,
          })
          .bindPopup(
            `<strong>${esc(i.nombre)}</strong><br><span style="color:#64748b">Punto de la institución (según sus marcaciones)</span>`,
          )
          .addTo(c);
        limites.push([i.lat, i.lng]);
      }

      for (const g of grupos) {
        const lejos = g.puntos.some((p) => p.lejos);
        const color = lejos ? AMBAR : AZUL;
        const extra =
          g.puntos.length > 1
            ? `<span style="position:absolute;top:-6px;right:-8px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#fff;color:${color};font:700 10px/18px system-ui;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.3)">+${g.puntos.length - 1}</span>`
            : "";
        const marcador = mod
          .marker([g.lat, g.lng], {
            icon: mod.divIcon({
              className: "",
              iconSize: [30, 30],
              iconAnchor: [15, 15],
              popupAnchor: [0, -14],
              html: `<div style="position:relative;width:30px;height:30px;border-radius:50%;background:${color};color:#fff;display:grid;place-items:center;font:700 12px system-ui;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${g.puntos[0].n}${extra}</div>`,
            }),
          })
          .bindPopup(
            g.puntos.map((p) => p.html).join('<hr style="margin:6px 0;border-color:#e2e8f0">'),
            {
              maxWidth: 280,
            },
          )
          .on("click", () => onSel.current(g.puntos[0].id))
          .addTo(c);
        for (const p of g.puntos) porId.current.set(p.id, marcador);
        limites.push([g.lat, g.lng]);
      }

      if (limites.length) m.fitBounds(limites, { padding: [40, 40], maxZoom: 16 });
      else m.setView(CENTRO, 6);
    });
    return () => {
      vivo = false;
    };
  }, [grupos, instituciones, recorridos]);

  // Elegir una marcación en la lista: volar hasta su pin y abrirlo.
  useEffect(() => {
    if (seleccionado == null) return;
    void listo.current?.then(() => {
      const marcador = porId.current.get(seleccionado);
      const m = mapa.current;
      if (!marcador || !m) return;
      m.flyTo(marcador.getLatLng(), Math.max(m.getZoom(), 16), { duration: 0.6 });
      marcador.openPopup();
    });
  }, [seleccionado]);

  return <div ref={div} className={className} role="region" aria-label="Mapa de intervenciones" />;
}
