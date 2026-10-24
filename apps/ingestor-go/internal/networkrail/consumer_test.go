package networkrail

import (
	"context"
	"fmt"
	"testing"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/records"
)

const loteValido = `[
 {"header":{"msg_type":"0003"},"body":{"train_id":"725N79M919","actual_timestamp":"1760000000000"}},
 {"header":{"msg_type":"0001"},"body":{"train_id":"B"}},
 {"roto":true}
]`

// paso registra en qué orden ocurrieron la escritura y la confirmación.
type paso struct {
	orden    []string
	lotes    [][]records.RawEvent
	fallar   error
	ackFalla error
}

func (p *paso) persist(_ context.Context, rows []records.RawEvent) (int, error) {
	if p.fallar != nil {
		p.orden = append(p.orden, "persist-falla")
		return 0, p.fallar
	}
	p.orden = append(p.orden, "persist")
	p.lotes = append(p.lotes, rows)
	return len(rows), nil
}

func (p *paso) ack() error {
	p.orden = append(p.orden, "ack")
	return p.ackFalla
}

func consumidor(p *paso, cb Callbacks) *Consumer {
	return NewConsumer(Options{
		Credentials: Credentials{Username: "u", Password: "p"},
	}, p.persist, cb)
}

// Un lote produce una fila por registro bien formado y cuenta el resto.
func TestUnLoteSeparaLoValidoDeLoQueNo(t *testing.T) {
	p := &paso{}
	c := consumidor(p, Callbacks{})
	if err := c.handleBody(context.Background(), []byte(loteValido), p.ack); err != nil {
		t.Fatalf("handleBody devolvió error: %v", err)
	}

	if len(p.lotes) != 1 || len(p.lotes[0]) != 2 {
		t.Fatalf("lotes = %d, filas = %v", len(p.lotes), p.lotes)
	}
	totals := c.Totals()
	if totals.Rows != 2 || totals.Inserted != 2 || totals.Skipped != 1 || totals.Batches != 1 {
		t.Errorf("contadores = %+v", totals)
	}
	if !p.lotes[0][0].HasObservedAt() {
		t.Error("la primera fila traía marca y debería conservarla")
	}
	if p.lotes[0][1].HasObservedAt() {
		t.Error("la segunda no traía marca")
	}
}

// El ack va después del commit, nunca antes: con ack automático, una caída
// entre recepción y escritura perdería eventos sin dejar rastro.
func TestElAckVaDespuesDeEscribir(t *testing.T) {
	p := &paso{}
	c := consumidor(p, Callbacks{})
	if err := c.handleBody(context.Background(), []byte(loteValido), p.ack); err != nil {
		t.Fatalf("handleBody devolvió error: %v", err)
	}
	if len(p.orden) != 2 || p.orden[0] != "persist" || p.orden[1] != "ack" {
		t.Errorf("orden = %v, se esperaba [persist ack]", p.orden)
	}
}

// Un fallo de escritura no confirma el mensaje ni tumba la sesión: el broker
// podrá reentregarlo y la clave de deduplicación evita el duplicado.
func TestUnFalloDeEscrituraNoConfirmaNiCorta(t *testing.T) {
	p := &paso{fallar: fmt.Errorf("connection refused")}
	var reportado string
	c := consumidor(p, Callbacks{
		OnError: func(event, code string) { reportado = event + ":" + code },
	})

	if err := c.handleBody(context.Background(), []byte(loteValido), p.ack); err != nil {
		t.Fatalf("un fallo de escritura no debe cortar la sesión: %v", err)
	}
	for _, step := range p.orden {
		if step == "ack" {
			t.Error("se confirmó un mensaje que no se pudo escribir")
		}
	}
	if reportado != "write-failed:ECONNREFUSED" {
		t.Errorf("reportado = %q", reportado)
	}
	if c.Totals().Batches != 0 {
		t.Error("un lote fallido no debería contar")
	}
}

// Si el ack falla, la sesión sí cae: el mensaje quedaría sin confirmar y hay
// que reconectar para que el broker lo reentregue.
func TestUnFalloDeAckCortaLaSesion(t *testing.T) {
	p := &paso{ackFalla: fmt.Errorf("broker se fue")}
	c := consumidor(p, Callbacks{})
	if err := c.handleBody(context.Background(), []byte(loteValido), p.ack); err == nil {
		t.Error("se esperaba que el fallo de ack se propagara")
	}
}

// Un cuerpo que no es una lista cuenta como descarte y se confirma igual: no
// tiene sentido pedir su reentrega.
func TestUnCuerpoInvalidoSeDescartaYSeConfirma(t *testing.T) {
	p := &paso{}
	c := consumidor(p, Callbacks{})
	if err := c.handleBody(context.Background(), []byte("esto no es json"), p.ack); err != nil {
		t.Fatalf("handleBody devolvió error: %v", err)
	}
	if c.Totals().Skipped != 1 || c.Totals().Rows != 0 {
		t.Errorf("contadores = %+v", c.Totals())
	}
	if len(p.orden) == 0 || p.orden[len(p.orden)-1] != "ack" {
		t.Errorf("orden = %v, debería confirmarse igualmente", p.orden)
	}
}

// Las repeticiones que la base ya tenía cuentan como duplicados, no como
// nuevas: es lo que distingue una reentrega de un evento nuevo.
func TestLasRepeticionesCuentanComoDuplicados(t *testing.T) {
	p := &paso{}
	c := consumidor(p, Callbacks{})
	// persist devuelve 0 insertadas aunque lleguen 2 filas.
	c.persist = func(context.Context, []records.RawEvent) (int, error) { return 0, nil }
	if err := c.handleBody(context.Background(), []byte(loteValido), p.ack); err != nil {
		t.Fatalf("handleBody devolvió error: %v", err)
	}
	totals := c.Totals()
	if totals.Rows != 2 || totals.Inserted != 0 || totals.Duplicates != 2 {
		t.Errorf("contadores = %+v", totals)
	}
}

func TestSafeErrorCodeNoFiltraElMensaje(t *testing.T) {
	cases := map[string]string{
		"dial tcp: connect: connection refused":      "ECONNREFUSED",
		"read: connection reset by peer":             "ECONNRESET",
		"authentication failed for user secreto":     "AUTHENTICATION_REJECTED",
		"not authorized to read from this topic":     "ACCESS_REJECTED",
		"operation timed out":                        "TIMEOUT",
		"algo raro que no encaja en ninguna familia": "REQUEST_OR_PROTOCOL_ERROR",
	}
	for message, want := range cases {
		if got := SafeErrorCode(fmt.Errorf("%s", message)); got != want {
			t.Errorf("%q dio %q, se esperaba %q", message, got, want)
		}
	}
	if SafeErrorCode(nil) != "" {
		t.Error("sin error no debería haber código")
	}
	// El mensaje puede llevar el usuario de la cuenta; nunca debe salir.
	if got := SafeErrorCode(fmt.Errorf("login failed for kenriortega")); got != "AUTHENTICATION_REJECTED" {
		t.Errorf("se filtró el mensaje: %q", got)
	}
}
