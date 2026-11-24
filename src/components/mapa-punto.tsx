import "leaflet/dist/leaflet.css";

import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";

/** El centro de Paraguay, para cuando todavía no hay punto. */
const CENTRO: [number, number] = [-23.44, -58.44];

const ICONO_HTML =
  '<div style="width:22px;height:22px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>';

/**
 * Un punto en el mapa (24/11/2026, el domicilio de un postulante). Con
 * `onCambio`, tocar el mapa o arrastrar el marcador lo mueve. Leaflet se carga
 * recién en el navegador, como en el mapa de intervenciones.
 */
export function MapaPunto({
  punto,
  onCambio,
  className = "h-56",
}: {
  punto: [number, number] | null;
  onCambio?: (lat: number, lng: number) => void;
  className?: string;
}) {
  const div = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const mapa = useRef<Leaflet.Map | null>(null);
  const marcador = useRef<Leaflet.Marker | null>(null);
  const listo = useRef<Promise<void> | null>(null);
  const cambio = useRef(onCambio);
  cambio.current = onCambio;
  const editable = !!onCambio;

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
      if (editable) {
        m.on("click", (e: Leaflet.LeafletMouseEvent) =>
          cambio.current?.(e.latlng.lat, e.latlng.lng),
        );
      }
      mapa.current = m;
      observador = new ResizeObserver(() => m.invalidateSize());
      observador.observe(div.current);
    })();
    return () => {
      cancelado = true;
      observador?.disconnect();
      mapa.current?.remove();
      mapa.current = null;
      marcador.current = null;
    };
  }, [editable]);

  // El marcador sigue al punto; el mapa se centra la primera vez.
  useEffect(() => {
    let vivo = true;
    void listo.current?.then(() => {
      const mod = L.current;
      const m = mapa.current;
      if (!vivo || !mod || !m) return;
      if (!punto) {
        marcador.current?.remove();
        marcador.current = null;
        return;
      }
      if (marcador.current) {
        marcador.current.setLatLng(punto);
      } else {
        marcador.current = mod
          .marker(punto, {
            draggable: editable,
            icon: mod.divIcon({
              className: "",
              iconSize: [22, 22],
              iconAnchor: [11, 11],
              html: ICONO_HTML,
            }),
          })
          .addTo(m);
        marcador.current.on("dragend", () => {
          const p = marcador.current?.getLatLng();
          if (p) cambio.current?.(p.lat, p.lng);
        });
        m.setView(punto, 15);
      }
    });
    return () => {
      vivo = false;
    };
  }, [punto?.[0], punto?.[1], editable]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={div}
      className={`z-0 w-full overflow-hidden rounded-xl border border-border/60 ${className}`}
    />
  );
}
