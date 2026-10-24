// Package domain contiene lo que el ingestor comparte conceptualmente con la
// web, pero no en código: la web usa `freshness` y `operators`, que no entran
// aquí porque el ingestor no los toca.
package domain

import (
	"time"

	// La base de zonas horarias, embebida en el binario. Sin esto
	// `LoadLocation("Europe/London")` depende de que el sistema traiga
	// /usr/share/zoneinfo, y la imagen final no trae sistema: el programa
	// moriría en el init de este paquete.
	_ "time/tzdata"
)

// London es la zona cuyo reloj de pared codifica TRUST.
var London = mustLoadLondon()

func mustLoadLondon() *time.Location {
	loc, err := time.LoadLocation("Europe/London")
	if err != nil {
		panic("domain: no se pudo cargar Europe/London: " + err.Error())
	}
	return loc
}

// Resolution dice si una hora local identificaba un instante, dos o ninguno.
type Resolution string

const (
	Unique      Resolution = "unique"
	Ambiguous   Resolution = "ambiguous"
	Nonexistent Resolution = "nonexistent"
)

// ResolvedInstant es el resultado de interpretar una hora de pared londinense.
type ResolvedInstant struct {
	// UTC es el instante real, o cero si esa hora local no existe.
	UTC           time.Time
	OffsetSeconds int
	Resolution    Resolution
}

// Ok indica que la hora local correspondía a algún instante.
func (r ResolvedInstant) Ok() bool { return r.Resolution != Nonexistent }

// offsets posibles de Europe/London, en milisegundos y en el mismo orden que
// la versión de TypeScript. El orden importa: en el pliegue de otoño ambos
// candidatos son válidos y se elige el primero, que es la lectura GMT.
var offsetsMs = [...]int64{0, 3600000}

// LondonOffsetMs devuelve el offset UTC vigente en Londres en ese instante.
//
// La versión de TypeScript lo calcula formateando la fecha y restando, porque
// JavaScript no sabe hacer aritmética con zonas horarias. Go sí, así que aquí
// es una consulta directa y la parte de sub-segundo no puede desplazar nada.
func LondonOffsetMs(instantMs int64) int64 {
	_, offsetSeconds := time.UnixMilli(instantMs).In(London).Zone()
	return int64(offsetSeconds) * 1000
}

// ResolveLondonLocalEpoch convierte una hora de pared de Londres codificada
// como epoch UTC al instante real.
//
// TRUST emite `actual_timestamp` como epoch en milisegundos pero con la hora
// de pared londinense ya incorporada. No vale restar una hora fija: el offset
// depende del momento del evento.
//
// Una hora local no siempre identifica un instante único. En el pliegue de
// otoño ocurre dos veces y en el salto de primavera no ocurre nunca, así que
// hay que comprobar los dos candidatos en lugar de calcular el offset una vez
// y restarlo.
func ResolveLondonLocalEpoch(localEpochMs int64) ResolvedInstant {
	for _, offset := range offsetsMs {
		instant := localEpochMs - offset
		if LondonOffsetMs(instant) != offset {
			continue
		}
		// Si el otro candidato también valdría, la hora es ambigua.
		resolution := Unique
		for _, other := range offsetsMs {
			if other != offset && LondonOffsetMs(localEpochMs-other) == other {
				resolution = Ambiguous
			}
		}
		return ResolvedInstant{
			UTC:           time.UnixMilli(instant).UTC(),
			OffsetSeconds: int(offset / 1000),
			Resolution:    resolution,
		}
	}
	return ResolvedInstant{Resolution: Nonexistent}
}

// LondonServiceDate da la fecha operativa en Londres, en formato ISO.
//
// Es una aproximación: los reportes de movimiento no traen fecha de servicio,
// y un tren que cruza medianoche produce dos fechas para una misma
// circulación.
func LondonServiceDate(instant time.Time) string {
	return instant.In(London).Format("2006-01-02")
}
