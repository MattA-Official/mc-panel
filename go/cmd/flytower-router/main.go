// Command flytower-router routes Minecraft players to a server by the hostname they typed, so
// every server on a machine can share port 25565 (#76). For now it only reports its version;
// the router itself lands in #232.
package main

import (
	"fmt"
	"io"
	"os"
)

// version is set when releases are packaged (scripts/package.ts), with
// -ldflags "-X main.version=1.5.0".
var version = "dev"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	switch {
	case len(args) == 0, len(args) == 1 && (args[0] == "--version" || args[0] == "version"):
		fmt.Fprintf(stdout, "flytower-router %s\n", version)
		return 0
	default:
		fmt.Fprintf(stderr, "usage: flytower-router [--version]\n")
		return 2
	}
}
