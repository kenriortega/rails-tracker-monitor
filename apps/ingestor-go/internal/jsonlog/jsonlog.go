// Package jsonlog escribe una línea JSON por evento, el mismo formato que los
// programas de TypeScript, para que una instalación pueda cambiar de unos a
// otros sin tocar la recolección de logs.
package jsonlog

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"
)

// Fields es el cuerpo de una línea.
type Fields map[string]any

func write(destination *os.File, fields Fields) {
	encoded, err := json.Marshal(fields)
	if err != nil {
		fmt.Fprintln(os.Stderr, `{"event":"log_failed"}`)
		return
	}
	fmt.Fprintf(destination, "%s\n", encoded)
}

// Info escribe por la salida estándar.
func Info(fields Fields) { write(os.Stdout, fields) }

// Fail escribe por la de error.
func Fail(fields Fields) { write(os.Stderr, fields) }

// At añade la marca de tiempo que llevan las líneas del consumidor y del
// proyector, en el mismo formato ISO que `new Date().toISOString()`.
func At(fields Fields) Fields {
	fields["at"] = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	return fields
}

// Describe recorre la cadena de causas y devuelve la primera, para que un
// fallo envuelto en tres capas no se reporte como un genérico inservible.
//
// Nunca se usa con errores del broker ni del portal, que pueden llevar el
// usuario en el mensaje: esos pasan por networkrail.SafeErrorCode.
func Describe(err error) string {
	if err == nil {
		return "unknown"
	}
	for current := err; current != nil; current = errors.Unwrap(current) {
		if current.Error() != "" {
			return current.Error()
		}
	}
	return "unknown"
}
