package projection

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

var received = time.Date(2026, 10, 19, 21, 0, 0, 0, time.UTC)

func movement(body string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"header":{"msg_type":"0003"},"body":%s}`, body))
}

func activation(body string) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"header":{"msg_type":"0001"},"body":%s}`, body))
}

func body(t *testing.T, s string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		t.Fatalf("json inválido: %v", err)
	}
	return m
}

// El signo del retraso lo da `variation_status`, no el número.
func TestElRetrasoTomaElSignoDelEstado(t *testing.T) {
	cases := map[string]int{
		`{"timetable_variation":"3","variation_status":"LATE"}`:    180,
		`{"timetable_variation":"3","variation_status":"EARLY"}`:   -180,
		`{"timetable_variation":"0","variation_status":"ON TIME"}`: 0,
	}
	for input, want := range cases {
		got := DelaySecondsFrom(body(t, input))
		if got == nil || *got != want {
			t.Errorf("%s dio %v, se esperaba %d", input, got, want)
		}
	}
}

// Una variación no interpretable no es un retraso de cero.
func TestVariacionNoInterpretableNoDaCero(t *testing.T) {
	for _, input := range []string{
		`{"timetable_variation":"2","variation_status":"OFF ROUTE"}`,
		`{"timetable_variation":"","variation_status":"LATE"}`,
		`{"variation_status":"LATE"}`,
	} {
		if got := DelaySecondsFrom(body(t, input)); got != nil {
			t.Errorf("%s dio %d, se esperaba nulo", input, *got)
		}
	}
}

func TestStanoxSeRellenaYSeRechaza(t *testing.T) {
	cases := map[string]string{
		`{"loc_stanox":"123"}`:   "00123",
		`{"loc_stanox":"87701"}`: "87701",
		`{"loc_stanox":"0"}`:     "",
		`{"loc_stanox":"ABC"}`:   "",
		`{}`:                     "",
	}
	for input, want := range cases {
		if got := StanoxFrom(body(t, input)); got != want {
			t.Errorf("%s dio %q, se esperaba %q", input, got, want)
		}
	}
}

func TestSoloSeProyectanLosMovimientos(t *testing.T) {
	for _, raw := range []json.RawMessage{
		json.RawMessage(`{"header":{"msg_type":"0001"},"body":{"train_id":"A"}}`),
		movement(`{}`),
		json.RawMessage(`null`),
	} {
		if _, ok := ProjectMovement(raw, received); ok {
			t.Errorf("%s no debería proyectarse", raw)
		}
	}
}

// La fecha de servicio sale de la fecha londinense del evento.
func TestFechaDeServicioDesdeLaFechaLondinense(t *testing.T) {
	m, ok := ProjectMovement(movement(`{"train_id":"725N79M919","actual_timestamp":"1760000000000"}`), received)
	if !ok {
		t.Fatal("debería proyectarse")
	}
	if m.ServiceDate != "2025-10-09" {
		t.Errorf("fecha = %q", m.ServiceDate)
	}
	if got := m.ObservedAt.Format(time.RFC3339); got != "2025-10-09T07:53:20Z" {
		t.Errorf("observedAt = %q", got)
	}
}

func TestSinMarcaUtilizableFechaLaRecepcion(t *testing.T) {
	m, ok := ProjectMovement(movement(`{"train_id":"A","actual_timestamp":"bad"}`), received)
	if !ok {
		t.Fatal("debería proyectarse")
	}
	if !m.ObservedAt.Equal(received) || m.ServiceDate != "2026-10-19" {
		t.Errorf("observedAt = %v, fecha = %q", m.ObservedAt, m.ServiceDate)
	}
}

func TestHeadcodeSaleDelIdentificador(t *testing.T) {
	m, _ := ProjectMovement(movement(`{"train_id":"725N79M919"}`), received)
	if m.Headcode != "5N79" {
		t.Errorf("headcode = %q", m.Headcode)
	}
	m, _ = ProjectMovement(movement(`{"train_id":"ABCDEFGHIJ"}`), received)
	if m.Headcode != "" {
		t.Errorf("headcode = %q, se esperaba vacío", m.Headcode)
	}
}

func TestElOperadorSeArrastraCuandoViene(t *testing.T) {
	cases := map[string]string{
		`{"train_id":"A","toc_id":"23"}`: "23",
		`{"train_id":"A"}`:               "",
		`{"train_id":"A","toc_id":""}`:   "",
	}
	for input, want := range cases {
		m, _ := ProjectMovement(movement(input), received)
		if m.TocID != want {
			t.Errorf("%s dio %q, se esperaba %q", input, m.TocID, want)
		}
	}
}

func TestTerminacionYRenumeracion(t *testing.T) {
	m, _ := ProjectMovement(movement(`{"train_id":"A","train_terminated":"true"}`), received)
	if m.Status != Terminated {
		t.Errorf("estado = %q", m.Status)
	}
	m, _ = ProjectMovement(movement(`{"train_id":"A"}`), received)
	if m.Status != Running {
		t.Errorf("estado = %q", m.Status)
	}
	m, _ = ProjectMovement(movement(`{"train_id":"A","current_train_id":"B"}`), received)
	if m.RenamedTo != "B" {
		t.Errorf("renamedTo = %q", m.RenamedTo)
	}
	m, _ = ProjectMovement(movement(`{"train_id":"A","current_train_id":"A"}`), received)
	if m.RenamedTo != "" {
		t.Errorf("renamedTo = %q, el mismo id no es renumeración", m.RenamedTo)
	}
}

// Una activación la fecha el feed, no la hora del evento.
func TestActivacionFechadaPorElFeed(t *testing.T) {
	a, ok := ProjectActivation(activation(
		`{"train_id":"725N79M919","tp_origin_timestamp":"2026-10-20","creation_timestamp":"1792463535000","toc_id":"25"}`), received)
	if !ok {
		t.Fatal("debería proyectarse")
	}
	if a.ProviderRunID != "725N79M919" || a.ServiceDate != "2026-10-20" || a.Headcode != "5N79" || a.TocID != "25" {
		t.Errorf("activación = %+v", a)
	}
}

func TestLaMarcaDeActivacionSeDecodificaIgual(t *testing.T) {
	a, _ := ProjectActivation(activation(
		`{"train_id":"A","tp_origin_timestamp":"2026-10-20","creation_timestamp":"1792463535000"}`), received)
	if got := a.ObservedAt.UnixMilli(); got != 1792463535000-3600000 {
		t.Errorf("observedAt = %d", got)
	}
}

func TestActivacionesSinFechaUtilizableSeDescartan(t *testing.T) {
	for _, raw := range []json.RawMessage{
		activation(`{"train_id":"A"}`),
		activation(`{"train_id":"A","tp_origin_timestamp":"no"}`),
		activation(`{"tp_origin_timestamp":"2026-10-20"}`),
		json.RawMessage(`{"header":{"msg_type":"0003"},"body":{"train_id":"A"}}`),
	} {
		if _, ok := ProjectActivation(raw, received); ok {
			t.Errorf("%s no debería proyectarse", raw)
		}
	}
}

func TestMarcaDeCreacionInutilCaeEnLaRecepcion(t *testing.T) {
	a, _ := ProjectActivation(activation(
		`{"train_id":"A","tp_origin_timestamp":"2026-10-20","creation_timestamp":"bad"}`), received)
	if !a.ObservedAt.Equal(received) {
		t.Errorf("observedAt = %v, se esperaba la recepción", a.ObservedAt)
	}
}
