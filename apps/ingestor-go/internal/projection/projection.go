// Package projection convierte los reportes crudos de TRUST en lo que la
// proyección necesita. Son funciones puras: no tocan la base.
package projection

import (
	"encoding/json"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/domain"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/records"
)

// Provider identifica el origen de las circulaciones.
const Provider = "TRUST"

// RunStatus es el estado de una circulación.
type RunStatus string

const (
	Activated  RunStatus = "activated"
	Running    RunStatus = "running"
	Terminated RunStatus = "terminated"
)

// Movement es lo que un reporte de movimiento aporta, ya normalizado.
type Movement struct {
	ProviderRunID string
	ServiceDate   string
	// Headcode es cadena vacía cuando el identificador no lo contiene.
	Headcode     string
	Status       RunStatus
	DelaySeconds *int
	TocID        string
	Stanox       string
	ObservedAt   time.Time
	// RenamedTo trae el identificador nuevo cuando la circulación se
	// renumera; informativo por ahora.
	RenamedTo string
}

// Activation es lo que aporta una activación: trenes previstos para hoy que
// aún no han reportado posición. Sin ellos solo se ven los que ya circulan, y
// su horario ya se conoce.
type Activation struct {
	ProviderRunID string
	// ServiceDate la da el feed en `tp_origin_timestamp`; no se deduce de la
	// hora del evento.
	ServiceDate string
	Headcode    string
	TocID       string
	ObservedAt  time.Time
	// ScheduledDeparture es la salida prevista del origen, con la misma
	// codificación londinense. Cero cuando no venía o no resolvía.
	ScheduledDeparture time.Time
}

// text replica el helper de TypeScript: solo cadenas, recortadas.
func text(value any) string {
	s, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(s)
}

var stanoxPattern = regexp.MustCompile(`^\d{1,5}$`)

// DelaySecondsFrom lee el retraso. `timetable_variation` llega en minutos sin
// signo; el signo lo da `variation_status`.
func DelaySecondsFrom(body map[string]any) *int {
	raw := text(body["timetable_variation"])
	// `Number("")` es cero: una variación ausente no es un retraso de cero.
	if raw == "" {
		return nil
	}
	minutes, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(minutes) || math.IsInf(minutes, 0) {
		return nil
	}
	seconds := int(math.Round(minutes * 60))
	switch strings.ToUpper(text(body["variation_status"])) {
	case "LATE":
		return &seconds
	case "EARLY":
		negative := -seconds
		return &negative
	case "ON TIME":
		zero := 0
		return &zero
	default:
		// OFF ROUTE u otros: el retraso no es interpretable.
		return nil
	}
}

// StanoxFrom normaliza el código de ubicación a cinco cifras, o cadena vacía.
func StanoxFrom(body map[string]any) string {
	raw := text(body["loc_stanox"])
	if !stanoxPattern.MatchString(raw) {
		return ""
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return ""
	}
	return strings.Repeat("0", 5-len(raw)) + raw
}

// headerBody extrae las dos mitades de un registro, comprobando el tipo.
func headerBody(payload json.RawMessage, msgType string) (map[string]any, bool) {
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil, false
	}
	header, ok := decoded["header"].(map[string]any)
	if !ok {
		return nil, false
	}
	body, ok := decoded["body"].(map[string]any)
	if !ok {
		return nil, false
	}
	if asString(header["msg_type"]) != msgType {
		return nil, false
	}
	return body, true
}

// asString replica el `String(x)` de JavaScript para los pocos tipos que
// pueden salir de un JSON: el campo `msg_type` debería ser cadena, pero el
// feed no está tipado.
func asString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case nil:
		return "undefined"
	default:
		return ""
	}
}

// ProjectMovement devuelve ok=false para todo lo que no sea un movimiento
// proyectable.
//
// El feed no trae fecha de servicio, así que se deriva de la fecha londinense
// del evento. Un tren que cruza medianoche producirá dos circulaciones.
func ProjectMovement(payload json.RawMessage, receivedAt time.Time) (Movement, bool) {
	body, ok := headerBody(payload, "0003")
	if !ok {
		return Movement{}, false
	}
	providerRunID := text(body["train_id"])
	if providerRunID == "" {
		return Movement{}, false
	}

	observedAt := records.ObservedAtFrom(body)
	if observedAt.IsZero() {
		observedAt = receivedAt
	}

	status := Running
	if strings.EqualFold(text(body["train_terminated"]), "true") {
		status = Terminated
	}

	renamedTo := ""
	if current := text(body["current_train_id"]); current != "" && current != providerRunID {
		renamedTo = current
	}

	return Movement{
		ProviderRunID: providerRunID,
		ServiceDate:   domain.LondonServiceDate(observedAt),
		Headcode:      domain.HeadcodeFromTrainId(providerRunID),
		Status:        status,
		DelaySeconds:  DelaySecondsFrom(body),
		TocID:         text(body["toc_id"]),
		Stanox:        StanoxFrom(body),
		ObservedAt:    observedAt,
		RenamedTo:     renamedTo,
	}, true
}

var serviceDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// londonEpoch interpreta una cadena con epoch londinense; cero si no resuelve.
func londonEpoch(raw string) time.Time {
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || value <= 0 || math.IsInf(value, 0) {
		return time.Time{}
	}
	resolved := domain.ResolveLondonLocalEpoch(int64(value))
	if !resolved.Ok() {
		return time.Time{}
	}
	return resolved.UTC
}

// ProjectActivation devuelve ok=false para lo que no sea una activación con
// fecha de servicio utilizable.
func ProjectActivation(payload json.RawMessage, receivedAt time.Time) (Activation, bool) {
	body, ok := headerBody(payload, "0001")
	if !ok {
		return Activation{}, false
	}
	providerRunID := text(body["train_id"])
	serviceDate := text(body["tp_origin_timestamp"])
	if providerRunID == "" || !serviceDatePattern.MatchString(serviceDate) {
		return Activation{}, false
	}

	// `creation_timestamp` usa la misma codificación londinense que los
	// movimientos.
	observedAt := londonEpoch(text(body["creation_timestamp"]))
	if observedAt.IsZero() {
		observedAt = receivedAt
	}

	return Activation{
		ProviderRunID:      providerRunID,
		ServiceDate:        serviceDate,
		Headcode:           domain.HeadcodeFromTrainId(providerRunID),
		TocID:              text(body["toc_id"]),
		ObservedAt:         observedAt,
		ScheduledDeparture: londonEpoch(text(body["origin_dep_timestamp"])),
	}, true
}
