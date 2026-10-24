package records

import (
	"encoding/json"
	"testing"
	"time"
)

var received = time.Date(2026, 10, 19, 21, 0, 0, 0, time.UTC)

func decode(t *testing.T, s string) any {
	t.Helper()
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		t.Fatalf("json inválido en el caso: %v", err)
	}
	return v
}

// La clave de deduplicación ignora el orden de las claves pero no el
// contenido.
func TestClaveDeDeduplicacion(t *testing.T) {
	a := decode(t, `{"header":{"msg_type":"0003"},"body":{"train_id":"A","loc_stanox":"12345"}}`)
	b := decode(t, `{"body":{"loc_stanox":"12345","train_id":"A"},"header":{"msg_type":"0003"}}`)
	if DeduplicationKey(a) != DeduplicationKey(b) {
		t.Error("el orden de las claves cambió la clave")
	}
	c := decode(t, `{"header":{"msg_type":"0003"},"body":{"train_id":"B","loc_stanox":"12345"}}`)
	if DeduplicationKey(a) == DeduplicationKey(c) {
		t.Error("un contenido distinto dio la misma clave")
	}
}

func TestFormaCanonica(t *testing.T) {
	got := Canonicalize(decode(t, `{"b":1,"a":{"d":2,"c":[3,1]}}`))
	if want := `{"a":{"c":[3,1],"d":2},"b":1}`; got != want {
		t.Errorf("canónico = %s, se esperaba %s", got, want)
	}
	// El orden de un array sí es significativo.
	if Canonicalize(decode(t, `[1,2]`)) == Canonicalize(decode(t, `[2,1]`)) {
		t.Error("el orden del array no debería perderse")
	}
}

// Los tres sitios donde `encoding/json` de Go y `JSON.stringify` divergen.
// Si alguno se rompe, los hashes dejan de coincidir con los ya guardados.
func TestFormaCanonicaCoincideConJavaScript(t *testing.T) {
	cases := map[string]string{
		`{"a":"<b>&c"}`:       `{"a":"<b>&c"}`,       // Go escaparía <
		`{"a":1e-7}`:          `{"a":1e-7}`,          // Go daría 1e-07
		`{"a":-0}`:            `{"a":0}`,             // Go daría -0
		`{"a":1760000000000}`: `{"a":1760000000000}`, // y no 1.76e+12
		`{"a":1.5}`:           `{"a":1.5}`,
		`{"a":null}`:          `{"a":null}`,
		`{"a":true}`:          `{"a":true}`,
		`{"a":"x\ny"}`:        `{"a":"x\ny"}`,
		`{"a":[]}`:            `{"a":[]}`,
		`{"a":{}}`:            `{"a":{}}`,
	}
	for input, want := range cases {
		if got := Canonicalize(decode(t, input)); got != want {
			t.Errorf("Canonicalize(%s) = %s, se esperaba %s", input, got, want)
		}
	}
}

// `observed_at` resuelve la codificación londinense en vez de fiarse del
// epoch crudo.
func TestObservedAtResuelveLaCodificacion(t *testing.T) {
	body := map[string]any{"actual_timestamp": "1760000000000"}
	got := ObservedAtFrom(body)
	if want := "2025-10-09T07:53:20Z"; got.Format(time.RFC3339) != want {
		t.Errorf("observedAt = %q, se esperaba %q", got.Format(time.RFC3339), want)
	}
	if got.UnixMilli() != 1760000000000-3600000 {
		t.Errorf("no se restó la hora de BST: %d", got.UnixMilli())
	}
}

func TestMarcasAusentesOFueraDeRango(t *testing.T) {
	for _, raw := range []any{nil, "", "bad", float64(0), float64(1), float64(9999999999999999)} {
		if got := ObservedAtFrom(map[string]any{"actual_timestamp": raw}); !got.IsZero() {
			t.Errorf("con %v se obtuvo %v, se esperaba cero", raw, got)
		}
	}
	if got := ObservedAtFrom(map[string]any{}); !got.IsZero() {
		t.Error("sin el campo debería quedar cero")
	}
}

func TestRegistrosMalFormadosSeDescartan(t *testing.T) {
	for _, raw := range []string{`null`, `{"header":{}}`, `{"header":[],"body":{}}`, `[1,2]`} {
		if _, ok := ToRawEvent(json.RawMessage(raw), received, MovementFeed); ok {
			t.Errorf("%s debería descartarse", raw)
		}
	}
	if _, skipped := RowsFromBatch([]byte("not json"), received, MovementFeed); skipped != 1 {
		t.Error("un cuerpo que no es JSON cuenta como un descarte")
	}
	if _, skipped := RowsFromBatch([]byte(`{"not":"an array"}`), received, MovementFeed); skipped != 1 {
		t.Error("un cuerpo que no es lista cuenta como un descarte")
	}
}

func TestLoteProduceUnaFilaPorRegistroValido(t *testing.T) {
	batch := []byte(`[
		{"header":{"msg_type":"0003"},"body":{"train_id":"A","actual_timestamp":"1760000000000"}},
		{"header":{"msg_type":"0001"},"body":{"train_id":"B"}},
		{"broken":true}
	]`)
	rows, skipped := RowsFromBatch(batch, received, MovementFeed)
	if len(rows) != 2 || skipped != 1 {
		t.Fatalf("filas = %d, descartes = %d", len(rows), skipped)
	}
	if got := rows[0].ObservedAt.Format(time.RFC3339); got != "2025-10-09T07:53:20Z" {
		t.Errorf("observedAt de la primera = %q", got)
	}
	if rows[1].HasObservedAt() {
		t.Error("la segunda no traía marca y no debería tenerla")
	}
	if !rows[0].ReceivedAt.Equal(received) || rows[0].Feed != MovementFeed {
		t.Error("feed o receivedAt incorrectos")
	}
	if rows[0].DeduplicationKey == rows[1].DeduplicationKey {
		t.Error("dos registros distintos compartieron clave")
	}
}

// El payload que se guarda son los bytes que llegaron, no una
// reserialización: la base debe conservar lo que mandó el proveedor.
func TestElPayloadConservaLosBytesOriginales(t *testing.T) {
	raw := json.RawMessage(`{"header":{"msg_type":"0003"},"body":{"train_id":"A"}}`)
	row, ok := ToRawEvent(raw, received, MovementFeed)
	if !ok {
		t.Fatal("debería aceptarse")
	}
	if string(row.Payload) != string(raw) {
		t.Errorf("payload = %s", row.Payload)
	}
}
