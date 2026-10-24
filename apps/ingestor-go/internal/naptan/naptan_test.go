package naptan

import (
	"strings"
	"testing"
)

// Un fragmento con las formas que trae el fichero real: una estación buena,
// una sin TIPLOC, una sin coordenadas y una parada que no es de tren.
const fragmento = `<?xml version="1.0" encoding="UTF-8"?>
<NaPTAN xmlns="http://www.naptan.org.uk/">
 <StopPoints>
  <StopPoint>
   <Descriptor><CommonName>York Rail Station</CommonName></Descriptor>
   <Place><Location><Longitude>-1.093</Longitude><Latitude>53.958</Latitude></Location></Place>
   <StopClassification><StopType>RLY</StopType>
    <OffStreet><Rail><AnnotatedRailRef><TiplocRef>YORK</TiplocRef><CrsRef>YRK</CrsRef></AnnotatedRailRef></Rail></OffStreet>
   </StopClassification>
  </StopPoint>
  <StopPoint>
   <Descriptor><CommonName>Sin tiploc</CommonName></Descriptor>
   <Place><Location><Longitude>-1.0</Longitude><Latitude>53.0</Latitude></Location></Place>
   <StopClassification><StopType>RLY</StopType></StopClassification>
  </StopPoint>
  <StopPoint>
   <Descriptor><CommonName>Sin coordenadas</CommonName></Descriptor>
   <StopClassification><StopType>RLY</StopType>
    <OffStreet><Rail><AnnotatedRailRef><TiplocRef>NOGEO</TiplocRef></AnnotatedRailRef></Rail></OffStreet>
   </StopClassification>
  </StopPoint>
  <StopPoint>
   <Descriptor><CommonName>Una parada de autobus</CommonName></Descriptor>
   <Place><Location><Longitude>-2.0</Longitude><Latitude>52.0</Latitude></Location></Place>
   <StopClassification><StopType>BCT</StopType></StopClassification>
  </StopPoint>
 </StopPoints>
</NaPTAN>`

func TestExtraeSoloEstacionesConTiplocYCoordenadas(t *testing.T) {
	var stations []RailStation
	totals, err := ParseRailStations(strings.NewReader(fragmento), func(s RailStation) {
		stations = append(stations, s)
	})
	if err != nil {
		t.Fatalf("ParseRailStations: %v", err)
	}

	if totals.StopPoints != 4 {
		t.Errorf("paradas = %d, se esperaban 4", totals.StopPoints)
	}
	// La de autobús no cuenta como parada de tren.
	if totals.RailStopPoints != 3 {
		t.Errorf("paradas de tren = %d, se esperaban 3", totals.RailStopPoints)
	}
	if totals.WithoutTiploc != 1 || totals.WithoutCoordinates != 1 {
		t.Errorf("sin tiploc = %d, sin coordenadas = %d", totals.WithoutTiploc, totals.WithoutCoordinates)
	}
	if totals.Stations != 1 || len(stations) != 1 {
		t.Fatalf("estaciones = %d, emitidas = %d", totals.Stations, len(stations))
	}

	got := stations[0]
	if got.Tiploc != "YORK" || got.CRS != "YRK" || got.Name != "York Rail Station" {
		t.Errorf("estación = %+v", got)
	}
	if got.Longitude != -1.093 || got.Latitude != 53.958 {
		t.Errorf("coordenadas = %v, %v", got.Longitude, got.Latitude)
	}
}

// El TIPLOC se normaliza a mayúsculas, como hace la versión de TypeScript.
func TestElTiplocSeNormaliza(t *testing.T) {
	xml := `<NaPTAN><StopPoint>
	 <CommonName>x</CommonName><Longitude>1</Longitude><Latitude>2</Latitude>
	 <StopType>RLY</StopType><TiplocRef> york </TiplocRef>
	</StopPoint></NaPTAN>`
	var stations []RailStation
	if _, err := ParseRailStations(strings.NewReader(xml), func(s RailStation) {
		stations = append(stations, s)
	}); err != nil {
		t.Fatalf("ParseRailStations: %v", err)
	}
	if len(stations) != 1 || stations[0].Tiploc != "YORK" {
		t.Errorf("estaciones = %+v", stations)
	}
}

// Solo el primer valor de cada nombre: el primero es el del propio StopPoint
// y los siguientes vienen de sus hijos.
func TestSoloSeTomaElPrimerValorDeCadaNombre(t *testing.T) {
	xml := `<NaPTAN><StopPoint>
	 <CommonName>Primero</CommonName><CommonName>Segundo</CommonName>
	 <Longitude>1</Longitude><Latitude>2</Latitude>
	 <StopType>RLY</StopType><TiplocRef>AAA</TiplocRef>
	</StopPoint></NaPTAN>`
	var stations []RailStation
	if _, err := ParseRailStations(strings.NewReader(xml), func(s RailStation) {
		stations = append(stations, s)
	}); err != nil {
		t.Fatalf("ParseRailStations: %v", err)
	}
	if len(stations) != 1 || stations[0].Name != "Primero" {
		t.Errorf("nombre = %q", stations[0].Name)
	}
}
