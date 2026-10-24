package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// LoadDotEnv carga el `.env` de la raíz del repositorio si existe, sin pisar
// nada que ya venga del entorno.
//
// Los programas de TypeScript lo leen con `loadEnvFile`, y sin esto un
// `go run ./cmd/prune` fallaría donde el equivalente en npm funcionaba. En
// contenedor no hay fichero y la función no hace nada: ahí las variables
// llegan por el entorno, que es lo correcto para un secreto.
func LoadDotEnv(start string) {
	path, ok := findDotEnv(start)
	if !ok {
		return
	}
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		name, value, ok := parseLine(scanner.Text())
		if !ok {
			continue
		}
		// El entorno manda: lo del fichero es solo el respaldo del desarrollo.
		if _, present := os.LookupEnv(name); !present {
			_ = os.Setenv(name, value)
		}
	}
}

// findDotEnv sube desde el directorio de trabajo buscando un `.env`. Así el
// programa se comporta igual lanzado desde la raíz o desde `apps/ingestor-go`.
func findDotEnv(start string) (string, bool) {
	if start == "" {
		working, err := os.Getwd()
		if err != nil {
			return "", false
		}
		start = working
	}
	for directory := start; ; {
		candidate := filepath.Join(directory, ".env")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, true
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return "", false
		}
		directory = parent
	}
}

func parseLine(line string) (name string, value string, ok bool) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return "", "", false
	}
	trimmed = strings.TrimPrefix(trimmed, "export ")
	name, value, found := strings.Cut(trimmed, "=")
	if !found {
		return "", "", false
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return "", "", false
	}
	return name, unquote(strings.TrimSpace(value)), true
}

// unquote quita las comillas que envuelven un valor. Dentro de comillas no se
// recorta ni se interpreta nada más: una contraseña puede acabar en espacio.
func unquote(value string) string {
	if len(value) >= 2 {
		if (value[0] == '"' && value[len(value)-1] == '"') ||
			(value[0] == '\'' && value[len(value)-1] == '\'') {
			return value[1 : len(value)-1]
		}
	}
	return value
}
