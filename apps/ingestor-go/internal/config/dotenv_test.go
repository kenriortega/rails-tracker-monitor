package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestElEntornoMandaSobreElFichero(t *testing.T) {
	directorio := t.TempDir()
	contenido := "" +
		"# un comentario\n" +
		"\n" +
		"DATABASE_URL=postgres://del-fichero\n" +
		"export NETWORK_RAIL_USERNAME = con-espacios \n" +
		"NETWORK_RAIL_PASSWORD=\"  clave con espacios  \"\n" +
		"SIN_IGUAL\n"
	if err := os.WriteFile(filepath.Join(directorio, ".env"), []byte(contenido), 0o600); err != nil {
		t.Fatal(err)
	}

	// Lo que ya viene del entorno no se pisa: en producción las variables
	// llegan por ahí y el fichero es solo el respaldo del desarrollo.
	t.Setenv("DATABASE_URL", "postgres://del-entorno")
	t.Setenv("NETWORK_RAIL_USERNAME", "")
	os.Unsetenv("NETWORK_RAIL_USERNAME")
	t.Setenv("NETWORK_RAIL_PASSWORD", "")
	os.Unsetenv("NETWORK_RAIL_PASSWORD")

	LoadDotEnv(directorio)

	if got := os.Getenv("DATABASE_URL"); got != "postgres://del-entorno" {
		t.Errorf("DATABASE_URL = %q; el fichero pisó al entorno", got)
	}
	if got := os.Getenv("NETWORK_RAIL_USERNAME"); got != "con-espacios" {
		t.Errorf("usuario = %q", got)
	}
	// Dentro de comillas no se recorta: una contraseña puede acabar en espacio.
	if got := os.Getenv("NETWORK_RAIL_PASSWORD"); got != "  clave con espacios  " {
		t.Errorf("contraseña = %q", got)
	}
}

func TestElFicheroSeBuscaHaciaArriba(t *testing.T) {
	raiz := t.TempDir()
	hondo := filepath.Join(raiz, "apps", "ingestor-go")
	if err := os.MkdirAll(hondo, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(raiz, ".env"), []byte("RAILS_PRUEBA=si\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RAILS_PRUEBA", "")
	os.Unsetenv("RAILS_PRUEBA")

	LoadDotEnv(hondo)
	if os.Getenv("RAILS_PRUEBA") != "si" {
		t.Error("no se encontró el .env de la raíz desde un subdirectorio")
	}
}

func TestSinFicheroNoPasaNada(t *testing.T) {
	// En contenedor no hay .env y eso es lo correcto.
	LoadDotEnv(t.TempDir())
}
