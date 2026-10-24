// Package config reúne la configuración por entorno de los cinco programas.
package config

import (
	"errors"
	"os"
	"strings"
)

// Credentials del portal de Network Rail.
type Credentials struct {
	Username string
	Password string
}

// Present dice si las dos están puestas. El usuario vacío cuenta como ausente,
// igual que el `?.trim()` del TypeScript.
func (c Credentials) Present() bool {
	return strings.TrimSpace(c.Username) != "" && c.Password != ""
}

// ErrNoDatabaseURL es lo que devuelven los programas cuando falta la cadena de
// conexión, que es el único requisito común a los cinco.
var ErrNoDatabaseURL = errors.New("config: falta DATABASE_URL")

// DatabaseURL lee la cadena de conexión.
func DatabaseURL() (string, error) {
	value := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if value == "" {
		return "", ErrNoDatabaseURL
	}
	return value, nil
}

// NetworkRail lee las credenciales del portal. No valida: quien las necesite
// decide si son obligatorias. La importación de NaPTAN, por ejemplo, funciona
// sin ellas y se queda sin STANOX.
func NetworkRail() Credentials {
	return Credentials{
		Username: strings.TrimSpace(os.Getenv("NETWORK_RAIL_USERNAME")),
		Password: os.Getenv("NETWORK_RAIL_PASSWORD"),
	}
}
