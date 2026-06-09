# syntax=docker/dockerfile:1

# Build context: ./apps/proxy (see render.yaml dockerContext).
FROM golang:1.22-alpine AS build
WORKDIR /src

COPY go.mod ./
# go.sum is intentionally optional — there are no external deps yet.
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /bin/proxy .

FROM alpine:3.20 AS runtime
RUN apk add --no-cache ca-certificates tini
COPY --from=build /bin/proxy /bin/proxy
USER nobody
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/bin/proxy"]
