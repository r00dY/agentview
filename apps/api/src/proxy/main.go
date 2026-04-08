package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"runtime"
)

func main() {
	runtime.GOMAXPROCS(1)

	listenPort := os.Getenv("AGENTVIEW_API_PORT")
	if listenPort == "" {
		log.Fatal("AGENTVIEW_API_PORT is not set")
	}

	targetPort := os.Getenv("HTTP_SERVER_PORT")
	if targetPort == "" {
		log.Fatal("HTTP_SERVER_PORT is not set")
	}

	target, err := url.Parse("http://127.0.0.1:" + targetPort)
	if err != nil {
		log.Fatalf("invalid target URL: %v", err)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)

	log.Printf("proxy listening on :%s -> :%s", listenPort, targetPort)
	if err := http.ListenAndServe(":"+listenPort, proxy); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
