// Package protocol is the Go side of the agent protocol: one JSON object per line, {id, verb,
// params} in and {id, ok, result | error} out. It matches packages/protocol/src/envelope.ts,
// which stays the source of truth (docs/decisions/0001-rust-and-go.md), and its tests replay
// the shared fixtures in protocol/fixtures so the two can't drift apart.
package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"unicode/utf16"
)

// Version is the protocol version a ping reports.
const Version = 1

// MaxLineBytes is the longest single message a reader accepts. Requests are tiny; this bounds
// memory.
const MaxLineBytes = 64 * 1024

// ErrorCode says why a request failed. The values are the strings of the TypeScript ErrorCode.
type ErrorCode string

const (
	BadRequest    ErrorCode = "bad_request" // not valid JSON, or not a valid envelope
	UnknownVerb   ErrorCode = "unknown_verb"
	InvalidParams ErrorCode = "invalid_params"
	Forbidden     ErrorCode = "forbidden" // the caller isn't allowed
	Conflict      ErrorCode = "conflict"
	NotFound      ErrorCode = "not_found"
	Failed        ErrorCode = "failed" // the operation ran and failed
	Internal      ErrorCode = "internal"
)

// Valid reports whether c is one of the codes the protocol defines.
func (c ErrorCode) Valid() bool {
	switch c {
	case BadRequest, UnknownVerb, InvalidParams, Forbidden, Conflict, NotFound, Failed, Internal:
		return true
	}
	return false
}

// Error is an error a handler returns, which becomes an error response.
type Error struct {
	Code    ErrorCode `json:"code"`
	Message string    `json:"message"`
}

func (e *Error) Error() string { return string(e.Code) + ": " + e.Message }

// NewError returns an error for a handler to return.
func NewError(code ErrorCode, message string) *Error { return &Error{Code: code, Message: message} }

// Request is a request that passed the envelope checks. Params are checked per verb later.
type Request struct {
	ID     string          `json:"id"`
	Verb   string          `json:"verb"`
	Params json.RawMessage `json:"params"`
}

var errEnvelope = errors.New("not a valid envelope")

// ParseRequest checks a line like the strict Zod Request: an object with exactly id, verb and
// params, where id and verb are strings of 1 to 64 characters.
func ParseRequest(line []byte) (Request, error) {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(line, &obj); err != nil || obj == nil {
		return Request{}, errEnvelope
	}
	params, ok := obj["params"]
	if len(obj) != 3 || !ok {
		return Request{}, errEnvelope
	}
	id, ok := shortString(obj["id"])
	if !ok {
		return Request{}, errEnvelope
	}
	verb, ok := shortString(obj["verb"])
	if !ok {
		return Request{}, errEnvelope
	}
	return Request{ID: id, Verb: verb, Params: params}, nil
}

// shortString accepts a JSON string of 1 to 64 characters, counted as JavaScript counts them
// (UTF-16 code units), so the limits agree with Zod's.
func shortString(raw json.RawMessage) (string, bool) {
	var s string
	if len(raw) == 0 || raw[0] != '"' || json.Unmarshal(raw, &s) != nil {
		return "", false
	}
	n := len(utf16.Encode([]rune(s)))
	return s, n >= 1 && n <= 64
}

// Response is one response line. Exactly one of Result and Error is set.
type Response struct {
	ID     string
	Result any
	Error  *Error
}

// OK returns a successful response.
func OK(id string, result any) Response { return Response{ID: id, Result: result} }

// Fail returns an error response.
func Fail(id string, err *Error) Response { return Response{ID: id, Error: err} }

// Encode returns the line to write: the JSON and a newline.
func (r Response) Encode() []byte {
	var v any
	if r.Error != nil {
		v = struct {
			ID    string `json:"id"`
			OK    bool   `json:"ok"`
			Error *Error `json:"error"`
		}{r.ID, false, r.Error}
	} else {
		result := r.Result
		if result == nil {
			result = struct{}{}
		}
		v = struct {
			ID     string `json:"id"`
			OK     bool   `json:"ok"`
			Result any    `json:"result"`
		}{r.ID, true, result}
	}
	line, err := json.Marshal(v)
	if err != nil {
		line = []byte(`{"id":"unknown","ok":false,"error":{"code":"internal","message":"unencodable"}}`)
	}
	return append(line, '\n')
}

// ValidResponse reports whether line is a response the TypeScript Response schema accepts.
// Clients written in Go use it to check what they're sent.
func ValidResponse(line []byte) bool {
	var obj map[string]json.RawMessage
	if json.Unmarshal(line, &obj) != nil || obj == nil {
		return false
	}
	var id string
	if raw := obj["id"]; len(raw) == 0 || raw[0] != '"' || json.Unmarshal(raw, &id) != nil {
		return false
	}
	switch string(bytes.TrimSpace(obj["ok"])) {
	case "true":
		_, ok := obj["result"]
		return ok
	case "false":
		var e struct {
			Code    *string `json:"code"`
			Message *string `json:"message"`
		}
		raw := obj["error"]
		if len(raw) == 0 || raw[0] != '{' || json.Unmarshal(raw, &e) != nil {
			return false
		}
		return e.Code != nil && ErrorCode(*e.Code).Valid() && e.Message != nil
	}
	return false
}
