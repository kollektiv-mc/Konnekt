// Dumps the scheduler's native block palette as JSON, for the browser demo's
// fixture backend to serve from GetScheduleBlockDefs.
//
// Generated rather than hand-written. backend/services/scheduler_blocks.go
// registers over fifty BlockDefs, each with its ports and config schema;
// transcribing that once would be a wall of JSON, and it would be wrong the
// first time somebody adds a block. This asks the registry instead, so the
// demo's palette is correct by construction.
//
// It reaches the registry through the ordinary constructor with nil
// dependencies: NewSchedulerService stores them and does not dereference any
// of them, and registering the builtins is the only thing this needs it to do.
// So nothing in backend/ changes to support the demo.
//
//	go run ./demo/tools/dump-blockdefs > demo/backend/fixtures/blockdefs.json
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"konnekt/backend/services"
)

func main() {
	defs, err := services.NewSchedulerService(nil, nil, nil, nil).GetBlockDefs()
	if err != nil {
		fmt.Fprintln(os.Stderr, "dump-blockdefs:", err)
		os.Exit(1)
	}
	if len(defs) == 0 {
		fmt.Fprintln(os.Stderr, "dump-blockdefs: the registry returned no blocks")
		os.Exit(1)
	}

	out := json.NewEncoder(os.Stdout)
	out.SetIndent("", "  ")
	if err := out.Encode(defs); err != nil {
		fmt.Fprintln(os.Stderr, "dump-blockdefs:", err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stderr, "dump-blockdefs: %d blocks\n", len(defs))
}
