// Package schedule analiza el feed SCHEDULE de Network Rail.
//
// Llega como JSON por líneas: una cabecera `JsonTimetableV1`, después
// registros `JsonScheduleV1`, `TiplocV1` y `JsonAssociationV1`. Se analiza en
// flujo porque el fichero diario completo no cabe cómodamente en memoria.
package schedule

import (
	"bufio"
	"encoding/json"
	"io"
	"regexp"
	"strings"
)

// Record es un horario utilizable.
type Record struct {
	UID          string
	ValidFrom    string
	ValidTo      string
	StpIndicator string
	// OriginTiploc y DestinationTiploc son el primer y último punto del
	// recorrido. Cadena vacía cuando el horario no los trae.
	OriginTiploc      string
	DestinationTiploc string
	SignallingID      string
	// Payload es el objeto `JsonScheduleV1` tal cual, para guardarlo en jsonb.
	Payload json.RawMessage
}

// Totals cuenta lo que trajo el fichero y por qué se descartó cada cosa.
type Totals struct {
	Lines         int
	Schedules     int
	Skipped       int
	OutsideWindow int
	Cancellations int
}

var isoDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// ParseLine devuelve ok=false para líneas que no sean un horario utilizable.
func ParseLine(line []byte) (Record, bool) {
	var wrapper struct {
		Schedule json.RawMessage `json:"JsonScheduleV1"`
	}
	if err := json.Unmarshal(line, &wrapper); err != nil || len(wrapper.Schedule) == 0 {
		return Record{}, false
	}

	var schedule struct {
		UID          string `json:"CIF_train_uid"`
		StartDate    string `json:"schedule_start_date"`
		EndDate      string `json:"schedule_end_date"`
		StpIndicator string `json:"CIF_stp_indicator"`
		Segment      struct {
			SignallingID string `json:"signalling_id"`
			Locations    []struct {
				TiplocCode string `json:"tiploc_code"`
			} `json:"schedule_location"`
		} `json:"schedule_segment"`
	}
	if err := json.Unmarshal(wrapper.Schedule, &schedule); err != nil {
		return Record{}, false
	}

	uid := strings.TrimSpace(schedule.UID)
	validFrom := strings.TrimSpace(schedule.StartDate)
	stp := strings.TrimSpace(schedule.StpIndicator)
	if uid == "" || !isoDatePattern.MatchString(validFrom) || stp == "" {
		return Record{}, false
	}

	// Sin fecha de fin utilizable, la validez es de un solo día.
	validTo := validFrom
	if end := strings.TrimSpace(schedule.EndDate); isoDatePattern.MatchString(end) {
		validTo = end
	}

	origin, destination := "", ""
	if n := len(schedule.Segment.Locations); n > 0 {
		origin = strings.ToUpper(strings.TrimSpace(schedule.Segment.Locations[0].TiplocCode))
		destination = strings.ToUpper(strings.TrimSpace(schedule.Segment.Locations[n-1].TiplocCode))
	}

	return Record{
		UID: uid, ValidFrom: validFrom, ValidTo: validTo, StpIndicator: stp,
		OriginTiploc: origin, DestinationTiploc: destination,
		SignallingID: strings.TrimSpace(schedule.Segment.SignallingID),
		Payload:      wrapper.Schedule,
	}, true
}

// CoversDate dice si la ventana de validez cubre esa fecha. Las fechas van en
// ISO, así que comparar como cadenas basta.
func (r Record) CoversDate(isoDate string) bool {
	return r.ValidFrom <= isoDate && isoDate <= r.ValidTo
}

// Read recorre las líneas de un flujo ya descomprimido y entrega los horarios
// cuya validez cubra `isoDate`. Importar el fichero entero multiplicaría el
// volumen sin que el enlace por activación pueda usar lo que queda fuera.
func Read(r io.Reader, isoDate string, emit func(Record) error) (Totals, error) {
	var totals Totals
	scanner := bufio.NewScanner(r)
	// Una línea de SCHEDULE puede ser larga: el búfer por defecto de 64 KiB
	// se queda corto con los horarios de muchas paradas.
	scanner.Buffer(make([]byte, 0, 256*1024), 8*1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(strings.TrimSpace(string(line))) == 0 {
			continue
		}
		totals.Lines++

		record, ok := ParseLine(line)
		if !ok {
			totals.Skipped++
			continue
		}
		// Las cancelaciones no describen un recorrido; se cuentan y no se
		// guardan.
		if record.StpIndicator == "C" {
			totals.Cancellations++
			continue
		}
		if !record.CoversDate(isoDate) {
			totals.OutsideWindow++
			continue
		}
		totals.Schedules++
		if err := emit(record); err != nil {
			return totals, err
		}
	}
	return totals, scanner.Err()
}
