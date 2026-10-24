package schedule

import (
	"fmt"
	"strings"
	"testing"
)

func unHorario(uid, from, to, stp string) string {
	return fmt.Sprintf(`{"JsonScheduleV1":{"CIF_train_uid":%q,"schedule_start_date":%q,`+
		`"schedule_end_date":%q,"CIF_stp_indicator":%q,"schedule_segment":{"signalling_id":"1A23",`+
		`"schedule_location":[{"tiploc_code":"euston"},{"tiploc_code":"crewe"},{"tiploc_code":"glgc"}]}}}`,
		uid, from, to, stp)
}

func TestAnalizaUnHorario(t *testing.T) {
	r, ok := ParseLine([]byte(unHorario("C12345", "2026-10-19", "2026-10-25", "P")))
	if !ok {
		t.Fatal("debería analizarse")
	}
	if r.UID != "C12345" || r.ValidFrom != "2026-10-19" || r.ValidTo != "2026-10-25" || r.StpIndicator != "P" {
		t.Errorf("registro = %+v", r)
	}
	// Primer y último punto del recorrido, normalizados a mayúsculas.
	if r.OriginTiploc != "EUSTON" || r.DestinationTiploc != "GLGC" {
		t.Errorf("origen = %q, destino = %q", r.OriginTiploc, r.DestinationTiploc)
	}
	if r.SignallingID != "1A23" {
		t.Errorf("signallingId = %q", r.SignallingID)
	}
	if len(r.Payload) == 0 {
		t.Error("el payload debería conservarse para guardarlo en jsonb")
	}
}

func TestLineasQueNoSonHorario(t *testing.T) {
	for _, line := range []string{
		`no es json`,
		`{"JsonTimetableV1":{"classification":"public"}}`,
		`{"TiplocV1":{"tiploc_code":"AAA"}}`,
		`{"JsonScheduleV1":{"schedule_start_date":"2026-10-19","CIF_stp_indicator":"P"}}`, // sin uid
		`{"JsonScheduleV1":{"CIF_train_uid":"X","schedule_start_date":"no","CIF_stp_indicator":"P"}}`,
		`{"JsonScheduleV1":{"CIF_train_uid":"X","schedule_start_date":"2026-10-19"}}`, // sin stp
	} {
		if _, ok := ParseLine([]byte(line)); ok {
			t.Errorf("%s no debería analizarse", line)
		}
	}
}

// Sin fecha de fin utilizable, la validez es de un solo día.
func TestSinFechaDeFinLaValidezEsDeUnDia(t *testing.T) {
	r, ok := ParseLine([]byte(`{"JsonScheduleV1":{"CIF_train_uid":"X",` +
		`"schedule_start_date":"2026-10-19","CIF_stp_indicator":"P"}}`))
	if !ok {
		t.Fatal("debería analizarse")
	}
	if r.ValidTo != "2026-10-19" {
		t.Errorf("validTo = %q", r.ValidTo)
	}
}

func TestCoversDate(t *testing.T) {
	r := Record{ValidFrom: "2026-10-19", ValidTo: "2026-10-25"}
	for date, want := range map[string]bool{
		"2026-10-18": false, "2026-10-19": true,
		"2026-10-22": true, "2026-10-25": true, "2026-10-26": false,
	} {
		if got := r.CoversDate(date); got != want {
			t.Errorf("%s dio %v", date, got)
		}
	}
}

// Las cancelaciones no describen un recorrido: se cuentan y no se guardan.
func TestReadCuentaYFiltra(t *testing.T) {
	lines := strings.Join([]string{
		`{"JsonTimetableV1":{}}`, // cabecera: descarte
		unHorario("DENTRO", "2026-10-19", "2026-10-25", "P"),
		unHorario("FUERA", "2026-01-01", "2026-01-02", "P"),
		unHorario("CANCELADO", "2026-10-19", "2026-10-25", "C"),
		``, // línea en blanco: ni se cuenta
		`basura`,
	}, "\n")

	var emitted []Record
	totals, err := Read(strings.NewReader(lines), "2026-10-22", func(r Record) error {
		emitted = append(emitted, r)
		return nil
	})
	if err != nil {
		t.Fatalf("Read: %v", err)
	}

	if totals.Lines != 5 {
		t.Errorf("líneas = %d, se esperaban 5 (la vacía no cuenta)", totals.Lines)
	}
	if totals.Schedules != 1 || len(emitted) != 1 || emitted[0].UID != "DENTRO" {
		t.Errorf("horarios = %d, emitidos = %+v", totals.Schedules, emitted)
	}
	if totals.OutsideWindow != 1 {
		t.Errorf("fuera de ventana = %d", totals.OutsideWindow)
	}
	if totals.Cancellations != 1 {
		t.Errorf("cancelaciones = %d", totals.Cancellations)
	}
	// La cabecera y la basura.
	if totals.Skipped != 2 {
		t.Errorf("descartes = %d", totals.Skipped)
	}
}

// Un error del emisor detiene la lectura en vez de seguir a ciegas.
func TestUnErrorDelEmisorDetieneLaLectura(t *testing.T) {
	lines := unHorario("A", "2026-10-19", "2026-10-25", "P") + "\n" +
		unHorario("B", "2026-10-19", "2026-10-25", "P")
	count := 0
	_, err := Read(strings.NewReader(lines), "2026-10-22", func(Record) error {
		count++
		return fmt.Errorf("la base no responde")
	})
	if err == nil {
		t.Error("se esperaba que el error se propagara")
	}
	if count != 1 {
		t.Errorf("se emitieron %d registros; debía parar en el primero", count)
	}
}
