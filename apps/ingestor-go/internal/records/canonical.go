// Package records convierte los lotes crudos de TRUST en filas.
package records

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Canonicalize serializa un valor con las claves de objeto ordenadas, para
// que el orden en que lleguen no altere el hash.
//
// Reproduce `JSON.stringify` de JavaScript, no el `encoding/json` de Go. No es
// un capricho: el SHA-256 de esta cadena es la clave de deduplicación que ya
// hay en la base, así que un solo byte de diferencia reinsertaría como nuevas
// todas las filas existentes. Las tres divergencias que había que salvar:
//
//   - `encoding/json` escapa `<`, `>` y `&` como `<` y compañía;
//     JSON.stringify no.
//   - Go formatea los exponentes con dos cifras (`1e-07`) y JavaScript con las
//     mínimas (`1e-7`).
//   - Go imprime el cero negativo como `-0`; JavaScript como `0`.
func Canonicalize(value any) string {
	var b strings.Builder
	writeCanonical(&b, value)
	return b.String()
}

func writeCanonical(b *strings.Builder, value any) {
	switch v := value.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		b.WriteString(strconv.FormatBool(v))
	case float64:
		b.WriteString(jsNumber(v))
	case string:
		writeJSString(b, v)
	case []any:
		b.WriteByte('[')
		for i, item := range v {
			if i > 0 {
				b.WriteByte(',')
			}
			writeCanonical(b, item)
		}
		b.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		// `Array.prototype.sort` ordena por unidades de código UTF-16. Para
		// las claves de TRUST, que son ASCII, coincide con el orden de bytes.
		sort.Strings(keys)
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			writeJSString(b, k)
			b.WriteByte(':')
			writeCanonical(b, v[k])
		}
		b.WriteByte('}')
	default:
		// `JSON.stringify` de un valor no serializable da `undefined`, que la
		// versión de TypeScript convierte en "null" con su `?? "null"`.
		b.WriteString("null")
	}
}

// jsNumber formatea como `Number.prototype.toString`, que es lo que usa
// JSON.stringify.
func jsNumber(f float64) string {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return "null" // JSON.stringify los emite así
	}
	if f == 0 {
		return "0" // y nunca "-0"
	}
	// Los enteros por debajo de 1e21 se imprimen sin exponente.
	if f == math.Trunc(f) && math.Abs(f) < 1e21 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return trimExponent(strconv.FormatFloat(f, 'g', -1, 64))
}

// trimExponent pasa de `1e-07` a `1e-7`: Go rellena el exponente a dos cifras
// y JavaScript no.
func trimExponent(s string) string {
	i := strings.IndexAny(s, "eE")
	if i < 0 {
		return s
	}
	mantissa, exp := s[:i], s[i+1:]
	sign := "+"
	if exp != "" && (exp[0] == '+' || exp[0] == '-') {
		sign, exp = string(exp[0]), exp[1:]
	}
	exp = strings.TrimLeft(exp, "0")
	if exp == "" {
		exp = "0"
	}
	return mantissa + "e" + sign + exp
}

// writeJSString escribe una cadena con el escapado de JSON.stringify.
func writeJSString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			switch {
			case r < 0x20:
				b.WriteString(`\u00`)
				const hex = "0123456789abcdef"
				b.WriteByte(hex[(r>>4)&0xf])
				b.WriteByte(hex[r&0xf])
			case r == utf8.RuneError:
				// Un sustituto suelto: JSON.stringify lo emite escapado desde
				// ES2019 en vez de producir UTF-8 inválido.
				b.WriteString(`�`)
			default:
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}
