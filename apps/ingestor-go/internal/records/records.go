package records

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/domain"
)

// MovementFeed es el nombre con el que se guardan los eventos de MOVEMENT.
const MovementFeed = "TRUST_MVT"

// Rango defensivo de epoch en milisegundos: del año 2000 al 2100.
const (
	epochFloor   int64 = 946684800000
	epochCeiling int64 = 4102444800000
)

// RawEvent es una fila lista para insertar en `raw_events`.
type RawEvent struct {
	Feed             string
	DeduplicationKey string
	// ObservedAt es cero cuando el registro no traía marca utilizable.
	ObservedAt time.Time
	ReceivedAt time.Time
	// Payload son los bytes originales del registro, no una reserialización:
	// lo que se guarda en la base debe ser lo que llegó.
	Payload json.RawMessage
}

// HasObservedAt distingue el cero de una marca real.
func (e RawEvent) HasObservedAt() bool { return !e.ObservedAt.IsZero() }

// DeduplicationKey identifica un mensaje idéntico, no un evento parecido: lo
// que debe deduplicarse aquí es la reentrega tras una reconexión. La
// deduplicación semántica corresponde a la proyección, que sí tiene contexto
// para decidirla.
func DeduplicationKey(record any) string {
	sum := sha256.Sum256([]byte(Canonicalize(record)))
	return hex.EncodeToString(sum[:])
}

// ObservedAtFrom lee `actual_timestamp`, que TRUST codifica como hora de pared
// de Londres disfrazada de UTC. Devuelve cero si falta o cae fuera de rango.
func ObservedAtFrom(body map[string]any) time.Time {
	raw, ok := body["actual_timestamp"]
	if !ok || raw == nil {
		return time.Time{}
	}
	stamp, ok := asEpochMs(raw)
	if !ok || stamp < epochFloor || stamp >= epochCeiling {
		return time.Time{}
	}
	resolved := domain.ResolveLondonLocalEpoch(stamp)
	if !resolved.Ok() {
		return time.Time{}
	}
	return resolved.UTC
}

// asEpochMs acepta número o cadena, como hace `Number(raw)` en TypeScript.
// TRUST manda los epoch como cadena, pero el campo no está tipado.
func asEpochMs(raw any) (int64, bool) {
	switch v := raw.(type) {
	case float64:
		if v != v || v > 1e18 || v < -1e18 {
			return 0, false
		}
		return int64(v), true
	case string:
		if v == "" {
			return 0, false
		}
		var f float64
		if err := json.Unmarshal([]byte(v), &f); err != nil {
			return 0, false
		}
		return int64(f), true
	default:
		return 0, false
	}
}

// ToRawEvent devuelve ok=false para cualquier registro sin la forma esperada.
func ToRawEvent(raw json.RawMessage, receivedAt time.Time, feed string) (RawEvent, bool) {
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return RawEvent{}, false
	}
	record, ok := decoded.(map[string]any)
	if !ok {
		return RawEvent{}, false
	}
	if _, ok := record["header"].(map[string]any); !ok {
		return RawEvent{}, false
	}
	body, ok := record["body"].(map[string]any)
	if !ok {
		return RawEvent{}, false
	}
	return RawEvent{
		Feed:             feed,
		DeduplicationKey: DeduplicationKey(record),
		ObservedAt:       ObservedAtFrom(body),
		ReceivedAt:       receivedAt,
		Payload:          raw,
	}, true
}

// RowsFromBatch convierte el cuerpo de un lote STOMP en filas y cuenta lo que
// descarta. Un cuerpo que no sea una lista cuenta como un descarte, igual que
// en la versión de TypeScript.
func RowsFromBatch(body []byte, receivedAt time.Time, feed string) (rows []RawEvent, skipped int) {
	var batch []json.RawMessage
	if err := json.Unmarshal(body, &batch); err != nil {
		return nil, 1
	}
	for _, raw := range batch {
		if row, ok := ToRawEvent(raw, receivedAt, feed); ok {
			rows = append(rows, row)
		} else {
			skipped++
		}
	}
	return rows, skipped
}
