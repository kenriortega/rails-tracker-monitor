package networkrail

import (
	"compress/gzip"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Portal es el origen del que cuelgan los ficheros de apoyo.
const Portal = "https://publicdatafeeds.networkrail.co.uk"

// Rutas de los dos ficheros que se descargan.
const (
	CorpusPath   = "/ntrod/SupportingFileAuthenticate?type=CORPUS"
	SchedulePath = "/ntrod/CifFileAuthenticate?type=CIF_ALL_FULL_DAILY&day=toc-full"
)

// maxRedirects es el mismo tope que el TypeScript.
const maxRedirects = 5

// ErrRedirectRejected señala un salto que la política no admite.
var ErrRedirectRejected = errors.New("REDIRECT_REJECTED")

// ErrTooManyRedirects señala que se agotó el tope de saltos.
var ErrTooManyRedirects = errors.New("TOO_MANY_REDIRECTS")

// FetchFeed descarga un fichero del portal siguiendo los redirecciones a mano.
//
// La cabecera `Authorization` solo viaja al portal. Las descargas acaban en una
// URL firmada de S3, que ya lleva su propia autorización en la query: mandar
// allí también las credenciales básicas las expondría a un tercero sin ninguna
// necesidad. Por eso no se usa el seguimiento automático del cliente.
//
// Quien recibe la respuesta es responsable de cerrar el cuerpo.
func FetchFeed(ctx context.Context, path string, credentials Credentials, timeout time.Duration) (*http.Response, error) {
	target, err := url.Parse(Portal)
	if err != nil {
		return nil, err
	}
	reference, err := url.Parse(path)
	if err != nil {
		return nil, ErrRedirectRejected
	}
	target = target.ResolveReference(reference)
	if origin(target) != Portal {
		return nil, ErrRedirectRejected
	}

	authorization := "Basic " + base64.StdEncoding.EncodeToString(
		[]byte(credentials.Username+":"+credentials.Password))

	client := &http.Client{
		Timeout: timeout,
		// El seguimiento lo hace este bucle, no el cliente.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}

	for redirects := 0; redirects < maxRedirects; redirects++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
		if err != nil {
			return nil, err
		}
		if origin(target) == Portal {
			request.Header.Set("Authorization", authorization)
		}
		response, err := client.Do(request)
		if err != nil {
			return nil, err
		}
		if !isRedirect(response.StatusCode) {
			return response, nil
		}

		location := response.Header.Get("Location")
		_ = response.Body.Close()
		if location == "" {
			return nil, ErrRedirectRejected
		}
		next, err := url.Parse(location)
		if err != nil {
			return nil, ErrRedirectRejected
		}
		next = target.ResolveReference(next)
		if !allowedHop(next) {
			return nil, ErrRedirectRejected
		}
		target = next
	}
	return nil, ErrTooManyRedirects
}

func isRedirect(status int) bool {
	switch status {
	case http.StatusMovedPermanently, http.StatusFound, http.StatusSeeOther,
		http.StatusTemporaryRedirect, http.StatusPermanentRedirect:
		return true
	}
	return false
}

// allowedHop admite solo HTTPS, sin credenciales en la URL, y hacia el portal
// o hacia S3, que es donde el portal sirve las descargas grandes.
func allowedHop(next *url.URL) bool {
	if next.Scheme != "https" || next.User != nil {
		return false
	}
	return origin(next) == Portal || strings.HasSuffix(next.Hostname(), ".amazonaws.com")
}

func origin(u *url.URL) string {
	return u.Scheme + "://" + u.Host
}

// ErrBodyLimit señala una respuesta mayor de lo admitido.
var ErrBodyLimit = errors.New("BODY_LIMIT")

// ErrEmptyBody señala una respuesta sin contenido.
var ErrEmptyBody = errors.New("EMPTY_BODY")

// DecodedBody descomprime la respuesta si viene en gzip y la deja tal cual si
// no, y corta la lectura pasado el límite.
//
// El fichero se reconoce por sus dos primeros bytes y no por el
// `Content-Encoding`: el portal sirve ficheros .gz como cuerpo opaco, sin
// anunciarlos como codificados, así que la cabecera no basta.
//
// Quien lo llama cierra lo que recibe; cerrar eso no cierra el cuerpo original.
func DecodedBody(body io.Reader, limitBytes int64) (io.ReadCloser, error) {
	limited := &limitedReader{inner: body, remaining: limitBytes}

	magic := make([]byte, 2)
	read, err := io.ReadFull(limited, magic)
	if read == 0 {
		if err == nil || errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, ErrEmptyBody
		}
		return nil, err
	}
	// Los bytes leídos para mirar la cabecera vuelven al principio del flujo.
	rest := io.MultiReader(strings.NewReader(string(magic[:read])), limited)
	if read == 2 && magic[0] == 0x1f && magic[1] == 0x8b {
		decompressed, err := gzip.NewReader(rest)
		if err != nil {
			return nil, fmt.Errorf("networkrail: gzip ilegible: %w", err)
		}
		return decompressed, nil
	}
	return io.NopCloser(rest), nil
}

// limitedReader corta con ErrBodyLimit en vez de con EOF, que es la diferencia
// que importa: un fichero truncado en silencio se importaría a medias.
type limitedReader struct {
	inner     io.Reader
	remaining int64
}

func (l *limitedReader) Read(p []byte) (int, error) {
	if l.remaining <= 0 {
		return 0, ErrBodyLimit
	}
	if int64(len(p)) > l.remaining {
		p = p[:l.remaining]
	}
	read, err := l.inner.Read(p)
	l.remaining -= int64(read)
	return read, err
}
