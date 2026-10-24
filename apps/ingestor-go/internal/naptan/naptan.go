// Package naptan extrae estaciones de ferrocarril del XML nacional de NaPTAN.
//
// NaPTAN publica el TIPLOC solo en el XML, dentro de AnnotatedRailRef; el CSV
// no lo incluye. El fichero nacional ronda los 580 MB, así que se analiza en
// flujo y nunca se carga entero en memoria.
package naptan

import (
	"encoding/xml"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// RailStation es una estación con TIPLOC y coordenadas utilizables.
type RailStation struct {
	Tiploc    string
	CRS       string
	Name      string
	Longitude float64
	Latitude  float64
}

// Totals cuenta lo que el fichero traía y por qué se descartó cada cosa.
type Totals struct {
	StopPoints         int
	RailStopPoints     int
	WithoutTiploc      int
	WithoutCoordinates int
	Stations           int
}

// wanted son los elementos cuyo texto interesa, por nombre local.
var wanted = map[string]bool{
	"StopType": true, "TiplocRef": true, "CrsRef": true,
	"Longitude": true, "Latitude": true, "CommonName": true,
}

// ParseRailStations recorre el XML y entrega cada estación con TIPLOC y
// coordenadas. El emisor se llama en el mismo hilo, en orden de aparición.
func ParseRailStations(r io.Reader, emit func(RailStation)) (Totals, error) {
	var totals Totals
	decoder := xml.NewDecoder(r)
	// El fichero declara espacios de nombres; se comparan los nombres
	// locales, igual que la versión de TypeScript recortando el prefijo.
	decoder.Strict = false

	var current map[string]string
	var capturing string

	for {
		token, err := decoder.Token()
		if err == io.EOF {
			return totals, nil
		}
		if err != nil {
			return totals, fmt.Errorf("naptan: XML ilegible: %w", err)
		}

		switch element := token.(type) {
		case xml.StartElement:
			name := element.Name.Local
			if name == "StopPoint" {
				current = map[string]string{}
				capturing = ""
				continue
			}
			// Solo el primer valor de cada nombre: el primero es el del
			// propio StopPoint, y los siguientes vienen de sus hijos.
			if current != nil && wanted[name] {
				if _, seen := current[name]; !seen {
					capturing = name
				}
			}
		case xml.CharData:
			if current != nil && capturing != "" {
				current[capturing] += string(element)
			}
		case xml.EndElement:
			name := element.Name.Local
			if name == capturing {
				capturing = ""
				continue
			}
			if name == "StopPoint" && current != nil {
				finish(current, &totals, emit)
				current = nil
			}
		}
	}
}

func finish(current map[string]string, totals *Totals, emit func(RailStation)) {
	totals.StopPoints++
	if current["StopType"] != "RLY" {
		return
	}
	totals.RailStopPoints++

	tiploc := strings.ToUpper(strings.TrimSpace(current["TiplocRef"]))
	if tiploc == "" {
		totals.WithoutTiploc++
		return
	}

	longitude, errLon := strconv.ParseFloat(strings.TrimSpace(current["Longitude"]), 64)
	latitude, errLat := strconv.ParseFloat(strings.TrimSpace(current["Latitude"]), 64)
	// Algunas estaciones tienen códigos válidos y geometría nula en NaPTAN.
	if errLon != nil || errLat != nil {
		totals.WithoutCoordinates++
		return
	}

	totals.Stations++
	emit(RailStation{
		Tiploc:    tiploc,
		CRS:       strings.TrimSpace(current["CrsRef"]),
		Name:      strings.TrimSpace(current["CommonName"]),
		Longitude: longitude,
		Latitude:  latitude,
	})
}
