package proxyproto

import (
	"bytes"
	"encoding/hex"
	"net/netip"
	"testing"
)

func TestHeader(t *testing.T) {
	for _, tc := range []struct{ name, src, dst, want string }{
		{"IPv4", "203.0.113.7:51000", "192.0.2.1:25565",
			"0d0a0d0a000d0a515549540a" + "21" + "11" + "000c" + "cb007107" + "c0000201" + "c738" + "63dd"},
		{"IPv4 in IPv6 is sent as IPv4", "[::ffff:203.0.113.7]:51000", "[::ffff:192.0.2.1]:25565",
			"0d0a0d0a000d0a515549540a" + "21" + "11" + "000c" + "cb007107" + "c0000201" + "c738" + "63dd"},
		{"IPv6", "[2001:db8::1]:51000", "[2001:db8::2]:25565",
			"0d0a0d0a000d0a515549540a" + "21" + "21" + "0024" +
				"20010db8000000000000000000000001" + "20010db8000000000000000000000002" + "c738" + "63dd"},
		{"mixed is sent as IPv6", "[2001:db8::1]:51000", "192.0.2.1:25565",
			"0d0a0d0a000d0a515549540a" + "21" + "21" + "0024" +
				"20010db8000000000000000000000001" + "00000000000000000000ffffc0000201" + "c738" + "63dd"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Header(netip.MustParseAddrPort(tc.src), netip.MustParseAddrPort(tc.dst))
			if err != nil {
				t.Fatal(err)
			}
			want, _ := hex.DecodeString(tc.want)
			if !bytes.Equal(got, want) {
				t.Errorf("got  %x\nwant %x", got, want)
			}
		})
	}
	if _, err := Header(netip.AddrPort{}, netip.MustParseAddrPort("192.0.2.1:1")); err == nil {
		t.Error("accepted an invalid address")
	}
}
