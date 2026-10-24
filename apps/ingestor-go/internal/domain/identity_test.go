package domain

import "testing"

func TestHeadcodeFromTrainId(t *testing.T) {
	cases := map[string]string{
		"771Y22MI20": "1Y22", // posiciones 3 a 6
		"xx9Z99yyyy": "9Z99",
		"xx9z99":     "9Z99", // se normaliza a mayúsculas
		"":           "",
		"short":      "", // menos de seis caracteres
		"xxABCDyyyy": "", // no cumple dígito-letra-dígito-dígito
		"xx1234yyyy": "",
	}
	for input, expected := range cases {
		if got := HeadcodeFromTrainId(input); got != expected {
			t.Errorf("HeadcodeFromTrainId(%q) = %q, se esperaba %q", input, got, expected)
		}
	}
}
