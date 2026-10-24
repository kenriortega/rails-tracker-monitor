package domain

import (
	"testing"
	"time"
)

// utcMs da el epoch en milisegundos de una fecha UTC, que es como la versión
// de TypeScript construye sus casos con `Date.UTC`.
func utcMs(y int, m time.Month, d, h, min, s int) int64 {
	return time.Date(y, m, d, h, min, s, 0, time.UTC).UnixMilli()
}

func TestVeranoRestaElOffsetDeBST(t *testing.T) {
	r := ResolveLondonLocalEpoch(utcMs(2026, time.July, 1, 12, 0, 0))
	if r.Resolution != Unique {
		t.Errorf("resolución = %q", r.Resolution)
	}
	if r.OffsetSeconds != 3600 {
		t.Errorf("offset = %d", r.OffsetSeconds)
	}
	if got := r.UTC.Format(time.RFC3339); got != "2026-07-01T11:00:00Z" {
		t.Errorf("utc = %q", got)
	}
}

func TestInviernoYaEsUTC(t *testing.T) {
	local := utcMs(2026, time.January, 15, 12, 0, 0)
	r := ResolveLondonLocalEpoch(local)
	if r.Resolution != Unique || r.OffsetSeconds != 0 {
		t.Errorf("resolución = %q, offset = %d", r.Resolution, r.OffsetSeconds)
	}
	if r.UTC.UnixMilli() != local {
		t.Errorf("el instante se movió: %d != %d", r.UTC.UnixMilli(), local)
	}
}

// El pliegue de otoño se reporta como ambiguo en vez de adivinarse en
// silencio. Las 01:30 locales ocurren dos veces el 25 de octubre de 2026.
func TestPliegueDeOtonoEsAmbiguo(t *testing.T) {
	r := ResolveLondonLocalEpoch(utcMs(2026, time.October, 25, 1, 30, 0))
	if r.Resolution != Ambiguous {
		t.Errorf("resolución = %q, se esperaba ambiguous", r.Resolution)
	}
	// Por convención se elige la lectura GMT, que es el primer candidato.
	if r.OffsetSeconds != 0 {
		t.Errorf("offset = %d, se esperaba 0", r.OffsetSeconds)
	}
	for _, h := range []int{0, 2} {
		if got := ResolveLondonLocalEpoch(utcMs(2026, time.October, 25, h, 30, 0)).Resolution; got != Unique {
			t.Errorf("a las %02d:30 la resolución = %q, se esperaba unique", h, got)
		}
	}
}

// El salto de primavera no produce instante: el reloj pasa de 01:00 a 02:00
// el 29 de marzo de 2026.
func TestSaltoDePrimaveraNoExiste(t *testing.T) {
	r := ResolveLondonLocalEpoch(utcMs(2026, time.March, 29, 1, 30, 0))
	if r.Resolution != Nonexistent {
		t.Errorf("resolución = %q", r.Resolution)
	}
	if r.Ok() || !r.UTC.IsZero() || r.OffsetSeconds != 0 {
		t.Error("una hora inexistente no debe devolver instante")
	}
}

func TestElOffsetSigueALaTransicion(t *testing.T) {
	if got := LondonOffsetMs(utcMs(2026, time.October, 19, 21, 0, 0)); got != 3600000 {
		t.Errorf("antes del cambio = %d", got)
	}
	if got := LondonOffsetMs(utcMs(2026, time.October, 26, 12, 0, 0)); got != 0 {
		t.Errorf("después del cambio = %d", got)
	}
	// La parte de sub-segundo no debe desplazar el offset.
	if got := LondonOffsetMs(utcMs(2026, time.July, 1, 12, 0, 0) + 742); got != 3600000 {
		t.Errorf("con milisegundos = %d", got)
	}
}

func TestFechaDeServicioSigueLaHoraDeLondres(t *testing.T) {
	cases := map[string]time.Time{
		// 23:30 UTC del 1 de julio ya es día siguiente en BST.
		"2026-07-02": time.UnixMilli(utcMs(2026, time.July, 1, 23, 30, 0)),
		"2026-01-15": time.UnixMilli(utcMs(2026, time.January, 15, 23, 30, 0)),
		"2026-10-19": time.UnixMilli(utcMs(2026, time.October, 19, 12, 0, 0)),
	}
	for expected, instant := range cases {
		if got := LondonServiceDate(instant); got != expected {
			t.Errorf("fecha = %q, se esperaba %q", got, expected)
		}
	}
}
