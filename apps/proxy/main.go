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

func requireBackendURL(envKey string) (*url.URL, error) {
	raw := os.Getenv(envKey)
	if raw == "" {
		return nil, fmt.Errorf("%s is not set", envKey)
	}
	return url.Parse(raw)
}

func main() {
	runtime.GOMAXPROCS(1)

	listenPort := os.Getenv("AGENTVIEW_API_PORT")
	if listenPort == "" {
		log.Fatal("AGENTVIEW_API_PORT is not set")
	}

	target, err := requireBackendURL("HTTP_SERVER_URL")
	if err != nil {
		log.Fatal(err)
	}

	streamingURL, err := requireBackendURL("STREAMING_SERVER_URL")
	if err != nil {
		log.Fatal(err)
	}
	streamingBase := strings.TrimRight(streamingURL.String(), "/")

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

		streamURL := fmt.Sprintf("%s/streams/%s", streamingBase, streamId)
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

	mux := http.NewServeMux()
	// Local health — must not proxy upstream so render's healthcheck stays
	// independent of the http server (which we don't want to redeploy often).
	mux.HandleFunc("/__gateway/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	})
	mux.Handle("/", proxy)

	log.Printf("proxy listening on :%s -> %s (streaming: %s)", listenPort, target, streamingBase)
	if err := http.ListenAndServe(":"+listenPort, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
