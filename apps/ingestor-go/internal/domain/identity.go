package domain

import (
	"regexp"
	"strings"
)

// El `train_id` de TRUST son diez caracteres y lleva el headcode embebido en
// las posiciones 3 a 6.
//
// Verificado sobre 63 activaciones reales: en las 63, esos cuatro caracteres
// coinciden con los cuatro primeros de `schedule_wtt_id`. Ambos campos los
// emite TRUST, así que concuerdan dos valores del mismo origen y no dos
// sistemas independientes.
var headcodePattern = regexp.MustCompile(`^[0-9][A-Z][0-9]{2}$`)

// HeadcodeFromTrainId devuelve cadena vacía cuando no cumple el formato, en
// lugar de un valor inventado.
func HeadcodeFromTrainId(trainID string) string {
	if len(trainID) < 6 {
		return ""
	}
	candidate := strings.ToUpper(trainID[2:6])
	if !headcodePattern.MatchString(candidate) {
		return ""
	}
	return candidate
}
