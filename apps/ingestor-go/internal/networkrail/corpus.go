package networkrail

import (
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strings"
)

// ErrInvalidCorpus señala un CORPUS que no tiene la forma esperada.
var ErrInvalidCorpus = errors.New("INVALID_CORPUS")

// stanoxPattern admite de uno a cinco dígitos; luego se rellena a cinco.
var stanoxPattern = regexp.MustCompile(`^\d{1,5}$`)

// StanoxByTiploc lee el CORPUS y devuelve el STANOX de cada TIPLOC.
//
// CORPUS es la única fuente del STANOX: NaPTAN no lo publica, y es el campo
// por el que los movimientos de TRUST dicen dónde está el tren. Sin él las
// posiciones no se pueden resolver.
func StanoxByTiploc(r io.Reader) (map[string]string, error) {
	var document struct {
		TiplocData []map[string]any `json:"TIPLOCDATA"`
	}
	// El fichero ronda los pocos MB, así que se decodifica de una vez.
	if err := json.NewDecoder(r).Decode(&document); err != nil {
		return nil, ErrInvalidCorpus
	}
	if len(document.TiplocData) == 0 {
		return nil, ErrInvalidCorpus
	}

	byTiploc := make(map[string]string, len(document.TiplocData))
	for _, entry := range document.TiplocData {
		tiploc := strings.ToUpper(strings.TrimSpace(text(entry["TIPLOC"])))
		stanox, ok := normalizeStanox(text(entry["STANOX"]))
		if tiploc == "" || !ok {
			continue
		}
		byTiploc[tiploc] = stanox
	}
	return byTiploc, nil
}

// normalizeStanox rellena a cinco dígitos y rechaza el cero, que en CORPUS
// marca una entrada sin STANOX asignado en lugar de un emplazamiento real.
func normalizeStanox(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if !stanoxPattern.MatchString(trimmed) {
		return "", false
	}
	padded := strings.Repeat("0", 5-len(trimmed)) + trimmed
	if padded == "00000" {
		return "", false
	}
	return padded, true
}

// text devuelve el valor como cadena solo si lo era. CORPUS trae los dos
// campos como texto; cualquier otra cosa es una entrada que no sirve.
func text(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}
