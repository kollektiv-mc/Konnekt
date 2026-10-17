package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"sync"
	"syscall"
	"time"
)

// Client ID Metadata Documents (#514, § S9.7). A connector may identify
// itself with an https URL as its client_id; the document at that URL names
// it and lists its redirect URIs. The URL is fetched from remoteCIMDHost
// only, since Claude's clients are the only ones the redirect allowlist lets
// in, and even that fetch is pinned, because a resolver answers for the host
// and the host is not Konnekt's: https only, every resolved address public,
// the dial checked again against the address it actually connects to, no
// redirects followed, a timeout and a size cap, and no proxy, because through
// one the address checks would be judging the proxy. What the document says
// about itself is third-party text: the name is clamped and the host of the
// URL is what the consent page names as the party asking.

const (
	cimdTimeout = 10 * time.Second
	cimdMaxBody = 64 << 10
	cimdCache   = 5 * time.Minute
)

var (
	ErrCIMDURL     = errors.New("a client_id URL is https://" + remoteCIMDHost + " with a path, and nothing else")
	ErrCIMDAddress = errors.New("the client_id host resolves to a private, loopback or link-local address")
	ErrCIMDDoc     = errors.New("the client metadata document is not what the URL promised")
)

// cimdDocument is the subset of the document Konnekt reads.
type cimdDocument struct {
	ClientID     string   `json:"client_id"`
	ClientName   string   `json:"client_name"`
	ClientURI    string   `json:"client_uri"`
	RedirectURIs []string `json:"redirect_uris"`
	// aislop-ignore-next-line ai-slop/hardcoded-id -- an RFC 7591 field name, not an identifier
	TokenEndpointAuthMethod string `json:"token_endpoint_auth_method"`
}

type cimdEntry struct {
	doc     *cimdDocument
	fetched time.Time
}

// cimdFetcher fetches and caches documents. lookup and now are swappable for
// the tests, which never make a real request.
type cimdFetcher struct {
	mu     sync.Mutex
	cache  map[string]cimdEntry
	lookup func(ctx context.Context, host string) ([]netip.Addr, error)
	now    func() time.Time
	client *http.Client
}

func newCIMDFetcher() *cimdFetcher {
	f := &cimdFetcher{cache: map[string]cimdEntry{}, now: time.Now,
		lookup: func(ctx context.Context, host string) ([]netip.Addr, error) {
			return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		}}
	dialer := &net.Dialer{Timeout: cimdTimeout, Control: func(_, address string, _ syscall.RawConn) error {
		// The second look: the address the socket is about to connect to,
		// whatever the resolver said a moment ago (DNS rebinding).
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			host = address
		}
		ip, err := netip.ParseAddr(host)
		if err != nil || !publicAddress(ip) {
			return ErrCIMDAddress
		}
		return nil
	}}
	f.client = &http.Client{
		Timeout: cimdTimeout,
		Transport: &http.Transport{
			Proxy:               nil,
			DialContext:         dialer.DialContext,
			TLSHandshakeTimeout: cimdTimeout,
			DisableKeepAlives:   true,
		},
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("the client metadata URL redirected, which is not followed")
		},
	}
	return f
}

// publicAddress is the rule both looks apply: not loopback, private,
// link-local, multicast, unspecified or carrier-grade NAT, after unmapping an
// IPv4-in-IPv6 address so ::ffff:127.0.0.1 is 127.0.0.1.
func publicAddress(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() || ip.IsInterfaceLocalMulticast() {
		return false
	}
	return !netip.MustParsePrefix("100.64.0.0/10").Contains(ip)
}

// validCIMDURL is the shape a client_id URL must have before anything is
// resolved: https, the host remoteCIMDHost and no other, a path, no user
// info, no query and no fragment.
func validCIMDURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" ||
		u.Path == "" || u.Path == "/" || u.Port() != "" {
		return nil, ErrCIMDURL
	}
	if u.Hostname() != remoteCIMDHost {
		return nil, ErrCIMDURL
	}
	if u.String() != raw {
		return nil, ErrCIMDURL
	}
	return u, nil
}

// Fetch returns the document at clientID, from the cache when it is fresh.
func (f *cimdFetcher) Fetch(ctx context.Context, clientID string) (*cimdDocument, error) {
	u, err := validCIMDURL(clientID)
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	if e, ok := f.cache[clientID]; ok && f.now().Sub(e.fetched) < cimdCache {
		f.mu.Unlock()
		return e.doc, nil
	}
	f.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, cimdTimeout)
	defer cancel()
	addrs, err := f.lookup(ctx, u.Hostname())
	if err != nil || len(addrs) == 0 {
		return nil, fmt.Errorf("%w: %s does not resolve", ErrCIMDAddress, u.Hostname())
	}
	for _, ip := range addrs {
		if !publicAddress(ip) {
			return nil, ErrCIMDAddress
		}
	}
	doc, err := f.get(ctx, u)
	if err != nil {
		return nil, err
	}
	if doc.ClientID != clientID || len(doc.RedirectURIs) == 0 {
		return nil, ErrCIMDDoc
	}
	for _, r := range doc.RedirectURIs {
		if _, err := url.Parse(r); err != nil {
			return nil, ErrCIMDDoc
		}
	}
	f.mu.Lock()
	f.cache[clientID] = cimdEntry{doc: doc, fetched: f.now()}
	f.mu.Unlock()
	return doc, nil
}

func (f *cimdFetcher) get(ctx context.Context, u *url.URL) (*cimdDocument, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Konnekt")
	res, err := f.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrCIMDDoc, err)
	}
	defer func() {
		if err := res.Body.Close(); err != nil {
			slog.Debug("remote: close client metadata body", "error", err)
		}
	}()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: status %d", ErrCIMDDoc, res.StatusCode)
	}
	if mt, _, err := mime.ParseMediaType(res.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		return nil, fmt.Errorf("%w: not JSON", ErrCIMDDoc)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, cimdMaxBody+1))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrCIMDDoc, err)
	}
	if len(body) > cimdMaxBody {
		return nil, fmt.Errorf("%w: over %d bytes", ErrCIMDDoc, cimdMaxBody)
	}
	var doc cimdDocument
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrCIMDDoc, err)
	}
	return &doc, nil
}
