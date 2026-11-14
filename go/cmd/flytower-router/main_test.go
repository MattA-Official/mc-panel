package main

import (
	"bytes"
	"testing"
)

func TestVersion(t *testing.T) {
	for _, args := range [][]string{nil, {"--version"}, {"version"}} {
		var out, errs bytes.Buffer
		if code := run(args, &out, &errs); code != 0 {
			t.Fatalf("%q: exit %d", args, code)
		}
		if got := out.String(); got != "flytower-router dev\n" {
			t.Errorf("%q: printed %q", args, got)
		}
	}
}

func TestUnknownArgument(t *testing.T) {
	var out, errs bytes.Buffer
	if code := run([]string{"--nope"}, &out, &errs); code != 2 {
		t.Fatalf("exit %d, want 2", code)
	}
	if errs.Len() == 0 {
		t.Error("no usage message")
	}
}
