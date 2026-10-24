package networkrail

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/go-stomp/stomp/v3"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/records"
)

// Dirección del broker público de Network Rail.
const (
	BrokerAddress = "publicdatafeeds.networkrail.co.uk:61618"
	Destination   = "/topic/TRAIN_MVT_ALL_TOC"
)

// Credentials son las del portal de Network Rail, no las del wiki.
type Credentials struct {
	Username string
	Password string
}

// Totals lleva la cuenta de lo que ha pasado por el consumidor.
type Totals struct {
	Batches    int64
	Rows       int64
	Inserted   int64
	Duplicates int64
	Skipped    int64
	Reconnects int64
}

// Callbacks es lo que el consumidor reporta hacia fuera.
type Callbacks struct {
	OnConnected func(attempt int64)
	// OnGap avisa de un hueco de cobertura. No es recuperable: el broker no
	// reenvía lo emitido mientras no había sesión.
	OnGap   func(unreachable time.Duration)
	OnError func(event string, code string)
	// OnBatch se llama después de cada lote guardado.
	OnBatch func(rows int, inserted int, skipped int)
}

func (c Callbacks) connected(attempt int64) {
	if c.OnConnected != nil {
		c.OnConnected(attempt)
	}
}
func (c Callbacks) gap(d time.Duration) {
	if c.OnGap != nil {
		c.OnGap(d)
	}
}
func (c Callbacks) failed(event, code string) {
	if c.OnError != nil {
		c.OnError(event, code)
	}
}
func (c Callbacks) batch(rows, inserted, skipped int) {
	if c.OnBatch != nil {
		c.OnBatch(rows, inserted, skipped)
	}
}

// Persist guarda un lote y devuelve cuántas filas eran nuevas.
type Persist func(context.Context, []records.RawEvent) (int, error)

// Options configura el consumidor.
type Options struct {
	Credentials    Credentials
	Address        string
	Destination    string
	Feed           string
	InitialBackoff time.Duration
	MaxBackoff     time.Duration
	// AckMode es `client-individual` en producción: cada mensaje se confirma
	// por separado y solo después del commit. Las pruebas lo bajan a `auto`
	// porque el servidor embebido de go-stomp no manda la cabecera `ack`, sin
	// la cual `client-individual` no se puede ejercitar.
	AckMode stomp.AckMode
}

func (o *Options) applyDefaults() {
	if o.Address == "" {
		o.Address = BrokerAddress
	}
	if o.Destination == "" {
		o.Destination = Destination
	}
	if o.Feed == "" {
		o.Feed = records.MovementFeed
	}
	if o.InitialBackoff <= 0 {
		o.InitialBackoff = time.Second
	}
	if o.MaxBackoff < o.InitialBackoff {
		o.MaxBackoff = 60 * time.Second
	}
	if o.AckMode == 0 {
		o.AckMode = stomp.AckClientIndividual
	}
}

// Consumer mantiene la suscripción a MOVEMENT y escribe lo que llega.
type Consumer struct {
	options  Options
	persist  Persist
	callback Callbacks

	// Los contadores los escribe el bucle de consumo y los lee quien
	// reporte el estado, así que van bajo candado.
	mu     sync.Mutex
	totals Totals
}

// NewConsumer no conecta: eso ocurre en Run.
func NewConsumer(options Options, persist Persist, callbacks Callbacks) *Consumer {
	options.applyDefaults()
	return &Consumer{options: options, persist: persist, callback: callbacks}
}

// Totals devuelve una copia de los contadores.
func (c *Consumer) Totals() Totals {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.totals
}

// Run consume hasta que se cancele el contexto, reconectando con retroceso
// exponencial.
//
// El retroceso se reinicia en cada conexión buena: si no, una racha de cortes
// espaciados acabaría esperando el máximo aunque entre ellos la sesión hubiera
// durado horas.
func (c *Consumer) Run(ctx context.Context) error {
	backoff := c.options.InitialBackoff
	var disconnectedAt time.Time

	for attempt := int64(0); ctx.Err() == nil; attempt++ {
		if attempt > 0 {
			c.mu.Lock()
			c.totals.Reconnects++
			c.mu.Unlock()
		}

		err := c.session(ctx, attempt, &disconnectedAt, func() { backoff = c.options.InitialBackoff })
		if ctx.Err() != nil {
			break
		}
		if disconnectedAt.IsZero() {
			disconnectedAt = time.Now()
		}
		c.callback.failed("stream-failed", SafeErrorCode(err))

		if !sleep(ctx, backoff) {
			break
		}
		backoff *= 2
		if backoff > c.options.MaxBackoff {
			backoff = c.options.MaxBackoff
		}
	}
	return ctx.Err()
}

// session abre una conexión y la consume hasta que falla o termina.
func (c *Consumer) session(ctx context.Context, attempt int64, disconnectedAt *time.Time, onConnected func()) error {
	conn, err := stomp.Dial("tcp", c.options.Address,
		stomp.ConnOpt.Login(c.options.Credentials.Username, c.options.Credentials.Password),
		stomp.ConnOpt.Host("publicdatafeeds.networkrail.co.uk"),
		stomp.ConnOpt.AcceptVersion(stomp.V11),
		stomp.ConnOpt.AcceptVersion(stomp.V12),
		stomp.ConnOpt.HeartBeat(10*time.Second, 10*time.Second),
	)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Disconnect() }()

	if !disconnectedAt.IsZero() {
		// El hueco no se puede rellenar: el broker no reenvía lo emitido
		// mientras no había sesión.
		c.callback.gap(time.Since(*disconnectedAt))
		*disconnectedAt = time.Time{}
	}
	// Por defecto `client-individual`: cada mensaje se confirma por separado,
	// y solo después de que su transacción haya hecho commit.
	sub, err := conn.Subscribe(c.options.Destination, c.options.AckMode)
	if err != nil {
		return err
	}
	defer func() { _ = sub.Unsubscribe() }()

	// El aviso va después de suscribirse, no después de conectar: hasta aquí
	// no se está escuchando nada, y decir "conectado" antes haría creer que
	// no hay hueco cuando sí lo hay.
	onConnected()
	c.callback.connected(attempt + 1)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case message, open := <-sub.C:
			if !open {
				*disconnectedAt = time.Now()
				return fmt.Errorf("la suscripción se cerró")
			}
			if message.Err != nil {
				*disconnectedAt = time.Now()
				return message.Err
			}
			if err := c.handle(ctx, conn, message); err != nil {
				return err
			}
		}
	}
}

// handle guarda un mensaje y lo confirma. Las escrituras van en serie por
// construcción: este bucle es de una sola goroutine.
func (c *Consumer) handle(ctx context.Context, conn *stomp.Conn, message *stomp.Message) error {
	return c.handleBody(ctx, message.Body, func() error {
		if !c.options.AckMode.ShouldAck() {
			return nil
		}
		return conn.Ack(message)
	})
}

// handleBody es `handle` sin STOMP: toma el cuerpo y una función para
// confirmar. Separarlo permite probar el camino de lote, persistencia,
// contadores y orden del ack sin levantar un broker.
func (c *Consumer) handleBody(ctx context.Context, body []byte, ack func() error) error {
	receivedAt := time.Now().UTC()
	rows, skipped := records.RowsFromBatch(body, receivedAt, c.options.Feed)

	inserted, err := c.persist(ctx, rows)
	if err != nil {
		// Sin ack: el broker podrá reentregarlo, y la clave de deduplicación
		// evita que la repetición cree filas nuevas. Un fallo de escritura no
		// tumba la sesión; se registra y se sigue.
		c.callback.failed("write-failed", SafeErrorCode(err))
		return nil
	}

	// El ack va después del commit, nunca antes: con ack automático, una
	// caída entre recepción y escritura perdería eventos sin dejar rastro.
	if err := ack(); err != nil {
		return err
	}

	c.mu.Lock()
	c.totals.Batches++
	c.totals.Rows += int64(len(rows))
	c.totals.Inserted += int64(inserted)
	c.totals.Duplicates += int64(len(rows) - inserted)
	c.totals.Skipped += int64(skipped)
	c.mu.Unlock()

	// El aviso va fuera del candado y después de contar, de modo que quien
	// lo reciba ya pueda leer los contadores actualizados.
	c.callback.batch(len(rows), inserted, skipped)
	return nil
}

// sleep espera respetando la cancelación.
func sleep(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
