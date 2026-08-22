package services

import (
	"bufio"
	"os"
	"strings"
)

// writeProperty updates a single key in a Java-style key=value properties file,
// preserving all other lines and comments. Appends the key if not found.
func writeProperty(path, key, value string) error {
	f, err := os.Open(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	var lines []string
	found := false
	if f != nil {
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := scanner.Text()
			trimmed := strings.TrimSpace(line)
			if trimmed != "" && !strings.HasPrefix(trimmed, "#") {
				k, _, ok := strings.Cut(trimmed, "=")
				if ok && strings.TrimSpace(k) == key {
					lines = append(lines, key+"="+value)
					found = true
					continue
				}
			}
			lines = append(lines, line)
		}
		f.Close()
		if err := scanner.Err(); err != nil {
			return err
		}
	}

	if !found {
		lines = append(lines, key+"="+value)
	}

	return writeFileAtomic(path, []byte(strings.Join(lines, "\n")+"\n"), 0644)
}

// readProperties parses a Java-style key=value properties file.
// Blank lines and lines beginning with # are skipped.
// Returns an empty map (no error) if the file does not exist.
func readProperties(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()

	props := make(map[string]string)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		props[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	return props, scanner.Err()
}
