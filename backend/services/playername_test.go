package services

import (
	"errors"
	"strings"
	"testing"
)

func TestValidPlayerNameRefusesSelectors(t *testing.T) {
	ok := []string{"Steve", "a", "x_1", "Sixteen_chars_ok", ".BedrockGamertag", "*Bedrock_Name_16", "-x", "~Tilde"}
	for _, name := range ok {
		if err := ValidPlayerName(name); err != nil {
			t.Errorf("%q refused: %v", name, err)
		}
	}
	bad := map[string]string{
		"everyone":       "@a",
		"entities":       "@e[type=player]",
		"self":           "@s",
		"space":          "Ste ve",
		"empty":          "",
		"prefix only":    ".",
		"two prefixes":   "..Steve",
		"too long":       strings.Repeat("a", 17),
		"prefixed long":  "." + strings.Repeat("a", 17),
		"newline":        "Steve\nstop",
		"quote":          `"Steve"`,
		"unicode letter": "Stève",
	}
	for label, name := range bad {
		if err := ValidPlayerName(name); !errors.Is(err, ErrPlayerName) {
			t.Errorf("%s %q: got %v, want ErrPlayerName", label, name, err)
		}
	}
}
