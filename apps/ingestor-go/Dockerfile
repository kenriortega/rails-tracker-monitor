# Imagen de los ingestores de Network Rail.
#
# El contexto de build es este directorio y no la raíz del repositorio: el
# módulo es autocontenido, así que no necesita ni los workspaces de npm ni las
# migraciones.
#
# Los cinco programas van en una sola imagen. Son el mismo despliegue y
# comparten casi todo el código, así que separarlos daría cinco imágenes con
# las mismas dependencias dentro y una matriz de versiones que mantener. El
# proceso que se ejecuta se elige con --entrypoint.

FROM golang:1.25-alpine AS build

WORKDIR /src

# Las dependencias en su propia capa: cambiar código no vuelve a descargarlas.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO_ENABLED=0 da binarios estáticos, que es lo que permite la imagen final
# vacía. -trimpath quita las rutas de la máquina de build, para que dos builds
# del mismo commit den el mismo resultado.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /bin/ \
      ./cmd/ingestor ./cmd/project ./cmd/prune \
      ./cmd/import-naptan ./cmd/import-schedule

# La imagen final no lleva distribución: solo los binarios y los certificados.
# Sin sistema de ficheros no hay gestor de paquetes que parchear ni shell desde
# la que moverse si alguien entra.
FROM scratch

# El único motivo por el que esta imagen no puede ir del todo vacía: sin los
# certificados raíz, el TLS contra el portal de Network Rail falla con un error
# de verificación que no dice nada obvio.
#
# La base de zonas horarias no hace falta aquí: va embebida en los binarios
# (`time/tzdata` en internal/domain), porque Europe/London es parte de la
# lógica y no de la máquina.
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=build /bin/ingestor /bin/project /bin/prune /bin/import-naptan /bin/import-schedule /

# Numérico y no un nombre: `scratch` no tiene /etc/passwd donde resolverlo.
# 65534 es `nobody` por convención.
USER 65534:65534

# El ingestor es el único proceso permanente; los otros cuatro se lanzan con
# --entrypoint, por ejemplo:
#   docker run --entrypoint /prune rails-ingestor --days=7 --dry-run
ENTRYPOINT ["/ingestor"]
