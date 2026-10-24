// Package networkrail habla con los feeds de Network Rail.
package networkrail

import (
	"context"
	"errors"
	"net"
	"os"
	"strings"
)

// SafeErrorCode reduce un error a una categoría publicable.
//
// Los mensajes del broker pueden incluir el usuario de la cuenta, así que de
// un fallo de conexión solo sale una etiqueta conocida. Es el equivalente del
// `safeErrorCode` de TypeScript.
func SafeErrorCode(err error) string {
	if err == nil {
		return ""
	}
	switch {
	case errors.Is(err, context.Canceled):
		return "CANCELLED"
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, os.ErrDeadlineExceeded):
		return "TIMEOUT"
	}

	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		if dnsErr.IsTemporary || dnsErr.IsTimeout {
			return "EAI_AGAIN"
		}
		return "ENOTFOUND"
	}

	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "ETIMEDOUT"
	}

	// Lo que queda se clasifica por el texto, con el mismo criterio que la
	// versión de TypeScript y sin reproducir nunca el mensaje entero.
	message := strings.ToLower(err.Error())
	for pattern, code := range map[string]string{
		"connection refused": "ECONNREFUSED",
		"connection reset":   "ECONNRESET",
		"certificate":        "CERT_INVALID",
	} {
		if strings.Contains(message, pattern) {
			return code
		}
	}
	for _, pattern := range []string{"authentication", "invalid password", "invalid user", "login failed"} {
		if strings.Contains(message, pattern) {
			return "AUTHENTICATION_REJECTED"
		}
	}
	for _, pattern := range []string{"not authorized", "not authorised", "permission", "securityexception"} {
		if strings.Contains(message, pattern) {
			return "ACCESS_REJECTED"
		}
	}
	if strings.Contains(message, "timeout") || strings.Contains(message, "timed out") {
		return "TIMEOUT"
	}
	return "REQUEST_OR_PROTOCOL_ERROR"
}
