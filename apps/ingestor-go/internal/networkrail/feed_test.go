package networkrail

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestElCorpusDaElStanoxDeCadaTiploc(t *testing.T) {
	cuerpo := `{"TIPLOCDATA":[
		{"TIPLOC":" york ","STANOX":"27000"},
		{"TIPLOC":"LEEDS","STANOX":"899"},
		{"TIPLOC":"SINSTANOX","STANOX":"0"},
		{"TIPLOC":"RARO","STANOX":"no-es-un-numero"},
		{"TIPLOC":"","STANOX":"12345"}
	]}`
	byTiploc, err := StanoxByTiploc(strings.NewReader(cuerpo))
	if err != nil {
		t.Fatalf("StanoxByTiploc: %v", err)
	}
	// El TIPLOC se normaliza y el STANOX se rellena a cinco dígitos.
	if byTiploc["YORK"] != "27000" || byTiploc["LEEDS"] != "00899" {
		t.Errorf("mapa = %v", byTiploc)
	}
	// Cero, ilegible y sin TIPLOC no entran.
	if len(byTiploc) != 2 {
		t.Errorf("entradas = %d, se esperaban 2: %v", len(byTiploc), byTiploc)
	}
}

func TestUnCorpusSinDatosSeRechaza(t *testing.T) {
	for _, cuerpo := range []string{`{"TIPLOCDATA":[]}`, `{}`, `no es json`} {
		if _, err := StanoxByTiploc(strings.NewReader(cuerpo)); err != ErrInvalidCorpus {
			t.Errorf("%q dio %v, se esperaba ErrInvalidCorpus", cuerpo, err)
		}
	}
}

func TestElCuerpoGzipSeDescomprime(t *testing.T) {
	var comprimido bytes.Buffer
	escritor := gzip.NewWriter(&comprimido)
	_, _ = escritor.Write([]byte("hola"))
	_ = escritor.Close()

	leido, err := DecodedBody(&comprimido, 1<<20)
	if err != nil {
		t.Fatalf("DecodedBody: %v", err)
	}
	defer leido.Close()
	contenido, _ := io.ReadAll(leido)
	if string(contenido) != "hola" {
		t.Errorf("contenido = %q", contenido)
	}
}

func TestUnCuerpoSinComprimirPasaEntero(t *testing.T) {
	// Importa que los dos primeros bytes, leídos para mirar la cabecera,
	// vuelvan al flujo: si no, el fichero llegaría descabezado.
	leido, err := DecodedBody(strings.NewReader(`{"a":1}`), 1<<20)
	if err != nil {
		t.Fatalf("DecodedBody: %v", err)
	}
	defer leido.Close()
	contenido, _ := io.ReadAll(leido)
	if string(contenido) != `{"a":1}` {
		t.Errorf("contenido = %q", contenido)
	}
}

func TestPasadoElLimiteSeCortaConError(t *testing.T) {
	leido, err := DecodedBody(strings.NewReader(strings.Repeat("x", 100)), 10)
	if err != nil {
		t.Fatalf("DecodedBody: %v", err)
	}
	defer leido.Close()
	if _, err := io.ReadAll(leido); err != ErrBodyLimit {
		t.Errorf("error = %v, se esperaba ErrBodyLimit", err)
	}
}

func TestUnCuerpoVacioSeDistingue(t *testing.T) {
	if _, err := DecodedBody(strings.NewReader(""), 1<<20); err != ErrEmptyBody {
		t.Errorf("error = %v, se esperaba ErrEmptyBody", err)
	}
}

// La política de saltos es lo que impide que las credenciales acaben en un
// tercero: la descarga termina en una URL firmada de S3 que ya lleva la suya.
func TestLaPoliticaDeSaltos(t *testing.T) {
	casos := []struct {
		destino  string
		admitido bool
		porque   string
	}{
		{"https://publicdatafeeds.networkrail.co.uk/ntrod/x", true, "el propio portal"},
		{"https://ntrod-feeds.s3.amazonaws.com/CORPUS.gz", true, "la descarga firmada"},
		{"http://publicdatafeeds.networkrail.co.uk/x", false, "sin TLS"},
		{"https://usuario:clave@ntrod.s3.amazonaws.com/x", false, "credenciales en la URL"},
		{"https://ejemplo.invalido/x", false, "un tercero cualquiera"},
		{"https://amazonaws.com.ejemplo.invalido/x", false, "un dominio que solo lo parece"},
	}
	for _, caso := range casos {
		destino, err := url.Parse(caso.destino)
		if err != nil {
			t.Fatalf("%s: %v", caso.destino, err)
		}
		if allowedHop(destino) != caso.admitido {
			t.Errorf("%s (%s): admitido = %v", caso.destino, caso.porque, !caso.admitido)
		}
	}
}

// Y la cabecera solo se pone cuando el destino es el portal, que es la otra
// mitad de la garantía.
func TestLaAutorizacionSoloViajaAlPortal(t *testing.T) {
	var recibida string
	servidor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recibida = r.Header.Get("Authorization")
	}))
	defer servidor.Close()

	destino, _ := url.Parse(servidor.URL)
	if origin(destino) == Portal {
		t.Fatal("el servidor de prueba no puede ser el portal")
	}
	// FetchFeed rechaza una ruta que no resuelva contra el portal antes de
	// abrir ninguna conexión.
	if _, err := FetchFeed(context.Background(), servidor.URL, Credentials{Username: "u", Password: "p"}, time.Second); err != ErrRedirectRejected {
		t.Errorf("error = %v, se esperaba ErrRedirectRejected", err)
	}
	if recibida != "" {
		t.Errorf("se llegó a contactar al destino con %q", recibida)
	}
}
