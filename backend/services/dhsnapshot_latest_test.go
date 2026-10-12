package services

import (
	"strings"
	"testing"
	"time"
)

// --- latest.json, the pointer (#565) ---

func TestDHLatestRoundTripAndShape(t *testing.T) {
	l := DHLatest{Format: 1, CreatedAt: "2026-10-11T04:00:00Z", Index: "snapshots/20261011T040000Z/index.json"}
	data, err := l.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	// Kapital Launcher reads these three keys by name.
	for _, want := range []string{`"format": 1`, `"createdAt": "2026-10-11T04:00:00Z"`, `"index": "snapshots/20261011T040000Z/index.json"`} {
		if !strings.Contains(string(data), want) {
			t.Errorf("latest.json lacks %s:\n%s", want, data)
		}
	}
	if !strings.HasSuffix(string(data), "\n") {
		t.Error("no trailing newline")
	}
	got, err := parseDHLatest(data)
	if err != nil || got != l {
		t.Errorf("round trip = %+v (%v), want %+v", got, err, l)
	}
}

func TestParseDHLatestRefusals(t *testing.T) {
	for name, in := range map[string]string{
		"not json":                "<html>",
		"an index, not a pointer": `{"format":1,"createdAt":"x","partsBase":"../../parts/","levels":[]}`,
		"unknown format":          `{"format":2,"index":"a/index.json"}`,
		"no format":               `{"index":"a/index.json"}`,
		"no index":                `{"format":1,"createdAt":"2026-10-11T04:00:00Z"}`,
		"a blank index":           `{"format":1,"index":"  "}`,
	} {
		if _, err := parseDHLatest([]byte(in)); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
}

func TestLatestIndexKey(t *testing.T) {
	tests := []struct {
		name      string
		latestKey string
		index     string
		want      string
		bad       string
	}{
		{"beside the prefix", "dh/latest.json", "snapshots/20261011T040000Z/index.json", "dh/snapshots/20261011T040000Z/index.json", ""},
		{"at the bucket root", "latest.json", "snapshots/20261011T040000Z/index.json", "snapshots/20261011T040000Z/index.json", ""},
		{"a deeper prefix", "a/b/latest.json", "snapshots/x/index.json", "a/b/snapshots/x/index.json", ""},
		{"the private layout", "dh/tok/latest.json", "snapshots/x/index.json", "dh/tok/snapshots/x/index.json", ""},
		{"an absolute path", "dh/latest.json", "/etc/passwd", "", "relative"},
		{"a url", "dh/latest.json", "https://example.com/index.json", "", "scheme"},
		{"a scheme without slashes", "dh/latest.json", "javascript:alert(1)", "", "scheme"},
		{"a scheme-like first segment", "dh/latest.json", "s3:bucket/index.json", "", "scheme"},
		{"a parent segment", "dh/latest.json", "../other/index.json", "", "'..'"},
		{"an escape in the middle", "dh/latest.json", "snapshots/../../index.json", "", "'..'"},
		{"a dot segment", "dh/latest.json", "./snapshots/index.json", "", "'.'"},
		{"an empty segment", "dh/latest.json", "snapshots//index.json", "", "empty"},
		{"a trailing slash", "dh/latest.json", "snapshots/", "", "empty"},
		{"a backslash", "dh/latest.json", `snapshots\x\index.json`, "", "forward slashes"},
		{"a query", "dh/latest.json", "snapshots/x/index.json?x=1", "", "plain path"},
		{"a fragment", "dh/latest.json", "snapshots/x/index.json#a", "", "plain path"},
		{"a percent escape", "dh/latest.json", "snapshots/%2e%2e/index.json", "", "plain path"},
		{"a control character", "dh/latest.json", "snapshots/x\n/index.json", "", "plain path"},
		{"empty", "dh/latest.json", "", "", "no index"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := latestIndexKey(tc.latestKey, DHLatest{Format: 1, Index: tc.index})
			if tc.bad != "" {
				if err == nil || !strings.Contains(err.Error(), tc.bad) {
					t.Fatalf("got (%q, %v), want an error containing %q", got, err, tc.bad)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Errorf("got (%q, %v), want %q", got, err, tc.want)
			}
		})
	}
}

// What a publish writes is what a reader resolves back to the same key, in both
// layouts and with or without a prefix.
func TestLatestPointerResolvesBackToTheIndexKey(t *testing.T) {
	created := time.Date(2026, 10, 11, 4, 0, 0, 0, time.UTC)
	for _, prefix := range []string{"", "dh", "dh/deep/er"} {
		for _, token := range []string{"", "tok_en-1"} {
			keys, err := snapshotKeys(prefix, token, created)
			if err != nil {
				t.Fatal(err)
			}
			rel, err := dhRelativeKey(keys.Latest, keys.Index)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(rel, "snapshots/") {
				t.Errorf("prefix %q token %q: pointer = %q, want a path below latest.json", prefix, token, rel)
			}
			back, err := latestIndexKey(keys.Latest, DHLatest{Format: 1, Index: rel})
			if err != nil || back != keys.Index {
				t.Errorf("prefix %q token %q: resolved %q (%v), want %q", prefix, token, back, err, keys.Index)
			}
		}
	}
	if _, err := dhRelativeKey("dh/latest.json", "other/index.json"); err == nil {
		t.Error("a key outside latest.json's folder was given a relative form")
	}
}
