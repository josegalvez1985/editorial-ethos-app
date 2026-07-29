const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/**
 * "martes 29 de julio". A mano en lugar de `Intl`: Hermes no siempre trae el ICU
 * completo en Android y el mes saldría en inglés.
 *
 * En la web el equivalente es `date-fns` con locale `es`.
 */
export function fechaLarga(d = new Date()) {
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}
