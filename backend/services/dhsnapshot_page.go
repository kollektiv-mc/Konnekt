package services

import (
	"bytes"
	_ "embed" // the page template is compiled into the binary
	"errors"
	"fmt"
	"html/template"
	"path"
	"sync"
	"time"
)

// The snapshot's download page (#562): a static index.html written beside each
// snapshot's index.json, listing every level's assembled file with its size,
// date and the folder a client puts it in. It is rendered from the parsed index
// alone, with html/template, so a golden file can pin it byte for byte.

//go:embed templates/dhsnapshot_page.html
var dhPageSource string

// dhClientDataFolder is the folder under a client's game folder that holds each
// server's LODs; a level goes in <dhClientDataFolder>/<serverFolder>/<level>/.
const dhClientDataFolder = "Distant_Horizons_server_data"

// dhPageTemplate parses the embedded template once. A failure is returned to the
// caller instead of panicking at start-up, so a broken template fails a publish
// with a message and not the application.
var dhPageTemplate = sync.OnceValues(func() (*template.Template, error) {
	return template.New("dhsnapshot_page").Parse(dhPageSource)
})

type dhPageLevel struct {
	Folder     string
	Size       string
	Href       string
	ClientPath string
}

type dhPageView struct {
	Date      string
	DHVersion string
	Levels    []dhPageLevel
}

// renderDHPage renders the page for ix. An index with no levels is refused, not
// rendered as an empty page: a snapshot nobody can download is a fault to report.
// The same index always renders the same bytes.
func renderDHPage(ix DHIndex) ([]byte, error) {
	if len(ix.Levels) == 0 {
		return nil, errors.New("the snapshot has no levels, so there is nothing to put on a download page")
	}
	created, err := time.Parse(time.RFC3339, ix.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("the snapshot's createdAt %q is not a time: %w", ix.CreatedAt, err)
	}
	view := dhPageView{
		Date:      created.UTC().Format("2006-01-02") + " UTC",
		DHVersion: ix.DHVersion,
		Levels:    make([]dhPageLevel, 0, len(ix.Levels)),
	}
	for _, l := range ix.Levels {
		view.Levels = append(view.Levels, dhPageLevel{
			Folder:     l.Folder,
			Size:       dhPageSize(l.Size),
			Href:       l.Folder + "/" + dhDatabaseName,
			ClientPath: path.Join(dhClientDataFolder, ix.ServerFolder, l.Folder) + "/",
		})
	}
	tmpl, err := dhPageTemplate()
	if err != nil {
		return nil, fmt.Errorf("the download page template: %w", err)
	}
	var out bytes.Buffer
	if err := tmpl.Execute(&out, view); err != nil {
		return nil, fmt.Errorf("render the download page: %w", err)
	}
	return out.Bytes(), nil
}

// dhPageSize spells a size in binary units with one decimal: GiB from a gibibyte
// up (as near as one decimal can tell), MiB below.
func dhPageSize(n int64) string {
	const mib, gib = 1 << 20, 1 << 30
	// 1023.95 MiB is the first size that would print as "1024.0 MiB".
	if float64(n)/mib >= 1023.95 {
		return fmt.Sprintf("%.1f GiB", float64(n)/gib)
	}
	return fmt.Sprintf("%.1f MiB", float64(n)/mib)
}
