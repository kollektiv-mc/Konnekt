package services

import (
	"strings"
	"testing"
)

// notifyPayload runs the Notify block against a bus and returns what it emitted.
func notifyPayload(t *testing.T, cfg map[string]interface{}) map[string]interface{} {
	t.Helper()
	bus := NewEventBus()
	got := make(chan map[string]interface{}, 1)
	bus.Tap(func(event string, data any) {
		if m, ok := data.(map[string]interface{}); ok && event == EventScheduleNotify {
			got <- m
		}
	})
	e := &ExecContext{Config: cfg, svc: serviceDeps{bus: bus}}
	if res := execNotify(e); res.Port != "onComplete" {
		t.Fatalf("port = %q, want onComplete", res.Port)
	}
	select {
	case m := <-got:
		return m
	default:
		t.Fatal("no schedule:notify event emitted")
		return nil
	}
}

func TestNotifyBlockDeliverFieldDefaultsToBoth(t *testing.T) {
	def := commandBlock(t, "action.notify")
	var found bool
	for _, f := range def.ConfigSchema {
		if f.Key != "deliver" {
			continue
		}
		found = true
		if f.Type != "select" || f.Default != NotifyBoth || f.Required {
			t.Errorf("deliver = %+v, want an optional select defaulting to both", f)
		}
		labels := []string{}
		for _, o := range f.Options {
			labels = append(labels, o.Label)
		}
		if got := strings.Join(labels, "|"); got != "In-app|Desktop|In-app and desktop" {
			t.Errorf("option labels = %q", got)
		}
	}
	if !found {
		t.Fatal("action.notify has no deliver field")
	}
}

func TestNotifyBlockKeepsKindAndMessageFields(t *testing.T) {
	def := commandBlock(t, "action.notify")
	if len(def.ConfigSchema) < 2 || def.ConfigSchema[0].Key != "kind" ||
		def.ConfigSchema[1].Key != "message" {
		t.Fatalf("kind and message must stay first: %+v", def.ConfigSchema)
	}
}

// The description is one short sentence, per the registry's copy convention.
func TestNotifyBlockDescriptionIsOneShortSentence(t *testing.T) {
	d := commandBlock(t, "action.notify").Description
	if len(d) > 100 || !strings.HasSuffix(d, ".") || strings.Contains(d, ". ") {
		t.Errorf("description %q is not one sentence of at most 100 characters", d)
	}
	if strings.Contains(d, "—") {
		t.Errorf("description %q has an em dash", d)
	}
}

func TestNotifyPayloadCarriesDelivery(t *testing.T) {
	cases := map[string]string{
		"":        NotifyBoth, // a graph saved before the field existed
		"bogus":   NotifyBoth,
		"both":    NotifyBoth,
		"inApp":   NotifyInApp,
		"desktop": NotifyDesktop,
	}
	for in, want := range cases {
		t.Run("deliver="+in, func(t *testing.T) {
			cfg := map[string]interface{}{"kind": "warn", "message": "hi"}
			if in != "" {
				cfg["deliver"] = in
			}
			m := notifyPayload(t, cfg)
			if m["deliver"] != want || m["kind"] != "warn" || m["message"] != "hi" {
				t.Errorf("payload = %v, want deliver %q", m, want)
			}
		})
	}
}
