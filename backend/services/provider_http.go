package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

// providerAPI is one content provider's JSON API: Modrinth's or CurseForge's.
// It exists so the part of a client that is easy to get wrong, the 429
// back-off, has one implementation rather than one per provider.
type providerAPI struct {
	// name prefixes every error ("modrinth: HTTP 404: ..."), so a message
	// that reaches the tile says which source refused.
	name    string
	http    *http.Client
	baseURL string
	// headers sets what every request carries beyond the content type: the
	// User-Agent, and CurseForge's API key. An error refuses the call before
	// anything is sent, which is how a missing key stops a request.
	headers func(http.Header) error
}

// providerHTTPError is a non-2xx answer, kept typed so a client can tell a
// rejected credential (401, 403) from any other failure.
type providerHTTPError struct {
	provider string
	status   int
	body     string
}

func (e *providerHTTPError) Error() string {
	return fmt.Sprintf("%s: HTTP %d: %s", e.provider, e.status, truncate(e.body, 200))
}

// getJSON performs a GET and decodes the answer into out.
func (a providerAPI) getJSON(ctx context.Context, path string, out any) error {
	return a.do(ctx, http.MethodGet, path, nil, out)
}

// postJSON is getJSON with a JSON request body.
func (a providerAPI) postJSON(ctx context.Context, path string, body, out any) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("%s: encode request: %w", a.name, err)
	}
	return a.do(ctx, http.MethodPost, path, encoded, out)
}

// do sends one request, retrying a 429 up to three times and honouring
// Retry-After. The body is re-wrapped per attempt because a retry cannot
// re-read a consumed reader.
func (a providerAPI) do(ctx context.Context, method, path string, body []byte, out any) error {
	reqURL := a.baseURL + path
	const maxRetries = 3

	for attempt := 0; attempt < maxRetries; attempt++ {
		var reqBody io.Reader
		if body != nil {
			reqBody = bytes.NewReader(body)
		}
		req, err := http.NewRequestWithContext(ctx, method, reqURL, reqBody)
		if err != nil {
			return fmt.Errorf("%s: build request: %w", a.name, err)
		}
		if a.headers != nil {
			if err := a.headers(req.Header); err != nil {
				return err
			}
		}
		req.Header.Set("Accept", "application/json")
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}

		resp, err := a.http.Do(req)
		if err != nil {
			return fmt.Errorf("%s: %w", a.name, err)
		}

		respBody, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return fmt.Errorf("%s: read response: %w", a.name, err)
		}

		if resp.StatusCode == http.StatusTooManyRequests {
			wait := 2 * time.Second
			if ra := resp.Header.Get("Retry-After"); ra != "" {
				if secs, err := strconv.Atoi(ra); err == nil {
					wait = time.Duration(secs) * time.Second
				}
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(wait):
			}
			continue
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return &providerHTTPError{provider: a.name, status: resp.StatusCode, body: string(respBody)}
		}

		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("%s: decode response: %w", a.name, err)
		}
		return nil
	}
	return fmt.Errorf("%s: exceeded retry limit for %s", a.name, path)
}
