package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"runtime"
	"strings"
)

func main() {
	runtime.GOMAXPROCS(1)

	listenPort := os.Getenv("AGENTVIEW_API_PORT")
	if listenPort == "" {
		log.Fatal("AGENTVIEW_API_PORT is not set")
	}

	targetPort := os.Getenv("HTTP_SERVER_PORT")
	if targetPort == "" {
		targetPort = "1995"
	}

	streamingPort := os.Getenv("STREAMING_SERVER_PORT")
	if streamingPort == "" {
		streamingPort = "1999"
	}

	target, err := url.Parse("http://127.0.0.1:" + targetPort)
	if err != nil {
		log.Fatalf("invalid target URL: %v", err)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.FlushInterval = -1 // flush immediately for SSE

	proxy.ModifyResponse = func(resp *http.Response) error {
		streamId := resp.Header.Get("X-Run-Stream-Id")
		if streamId == "" {
			return nil
		}

		// Close original (empty) body
		resp.Body.Close()
		resp.Header.Del("X-Run-Stream-Id")

		// Connect to streaming server
		streamURL := fmt.Sprintf("http://127.0.0.1:%s/stream/%s", streamingPort, streamId)
		req, err := http.NewRequestWithContext(resp.Request.Context(), "GET", streamURL, nil)
		if err != nil {
			resp.StatusCode = 502
			msg := "failed to create stream request"
			resp.Body = io.NopCloser(strings.NewReader(msg))
			resp.ContentLength = int64(len(msg))
			return nil
		}

		streamResp, err := http.DefaultClient.Do(req)
		if err != nil {
			resp.StatusCode = 502
			msg := "streaming server unavailable"
			resp.Body = io.NopCloser(strings.NewReader(msg))
			resp.ContentLength = int64(len(msg))
			return nil
		}

		// Replace response with SSE stream
		resp.Body = streamResp.Body
		resp.StatusCode = 200
		resp.Status = "200 OK"
		resp.Header.Set("Content-Type", "text/event-stream")
		resp.Header.Set("Cache-Control", "no-cache")
		resp.Header.Set("Connection", "keep-alive")
		resp.Header.Del("Content-Length")
		resp.Header.Del("Transfer-Encoding")
		resp.ContentLength = -1

		return nil
	}

	log.Printf("proxy listening on :%s -> :%s (streaming: :%s)", listenPort, targetPort, streamingPort)
	if err := http.ListenAndServe(":"+listenPort, proxy); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
