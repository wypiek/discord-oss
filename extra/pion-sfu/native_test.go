package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"io"
	"net"
	"testing"
	"time"

	"github.com/pion/rtp"
	"golang.org/x/crypto/chacha20poly1305"
)

func testKey(seed byte) []byte {
	key := make([]byte, 32)
	for i := range key {
		key[i] = seed + byte(i)
	}
	return key
}

func discoveryRequest(ssrc uint32) []byte {
	request := make([]byte, discoveryPacketSize)
	binary.BigEndian.PutUint16(request[0:2], discoveryRequestType)
	binary.BigEndian.PutUint16(request[2:4], discoveryBodyLength)
	binary.BigEndian.PutUint32(request[4:8], ssrc)
	return request
}

func TestDiscoveryRequestIsNeverStun(t *testing.T) {
	if !isDiscoveryRequest(discoveryRequest(7)) {
		t.Fatal("a discovery request was not recognised")
	}
	stun := make([]byte, discoveryPacketSize)
	binary.BigEndian.PutUint16(stun[0:2], 0x0001)
	binary.BigEndian.PutUint16(stun[2:4], discoveryPacketSize-20)
	binary.BigEndian.PutUint32(stun[4:8], 0x2112a442)
	if isDiscoveryRequest(stun) {
		t.Fatal("a STUN binding request was taken for IP discovery")
	}
}

func TestDiscoveryResponseCarriesTheObservedAddress(t *testing.T) {
	response := discoveryResponse(0xdeadbeef, &net.UDPAddr{IP: net.ParseIP("203.0.113.7"), Port: 51234})
	if len(response) != discoveryPacketSize {
		t.Fatalf("response is %d bytes", len(response))
	}
	if binary.BigEndian.Uint16(response[0:2]) != discoveryResponseType || binary.BigEndian.Uint16(response[2:4]) != discoveryBodyLength {
		t.Fatalf("bad response header %x", response[:4])
	}
	if binary.BigEndian.Uint32(response[4:8]) != 0xdeadbeef {
		t.Fatal("ssrc not echoed")
	}
	address := string(bytes.TrimRight(response[8:8+discoveryAddressLength], "\x00"))
	if address != "203.0.113.7" {
		t.Fatalf("address %q", address)
	}
	if port := binary.BigEndian.Uint16(response[72:74]); port != 51234 {
		t.Fatalf("port %d", port)
	}
}

func independentAEAD(t *testing.T, mode string, key []byte) cipher.AEAD {
	t.Helper()
	if mode == modeXChaCha20Poly1305 {
		aead, err := chacha20poly1305.NewX(key)
		if err != nil {
			t.Fatal(err)
		}
		return aead
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	return aead
}

func TestSealedPacketsMatchTheRtpsizeLayout(t *testing.T) {
	for _, mode := range []string{modeAES256GCM, modeXChaCha20Poly1305} {
		t.Run(mode, func(t *testing.T) {
			key := testKey(3)
			nc, err := newNativeCipher(mode, key)
			if err != nil {
				t.Fatal(err)
			}
			payload := []byte{0xfc, 0xff, 0xfe, 1, 2, 3, 4, 5}
			pkt := &rtp.Packet{Header: rtp.Header{Version: 2, Marker: true, PayloadType: 111, SequenceNumber: 77, Timestamp: 960, SSRC: 4242}, Payload: payload}
			out, err := nc.seal(pkt, nativeOpusPayloadType, 9)
			if err != nil {
				t.Fatal(err)
			}
			if out[1] != 0x80|nativeOpusPayloadType {
				t.Fatalf("payload type byte %x", out[1])
			}
			if got := binary.BigEndian.Uint32(out[len(out)-4:]); got != 9 {
				t.Fatalf("nonce suffix %d", got)
			}
			aead := independentAEAD(t, mode, key)
			nonce := make([]byte, aead.NonceSize())
			binary.BigEndian.PutUint32(nonce, 9)
			plain, err := aead.Open(nil, nonce, out[12:len(out)-4], out[:12])
			if err != nil || !bytes.Equal(plain, payload) {
				t.Fatalf("independent decrypt failed: %v %x", err, plain)
			}
			opened, err := nc.open(out)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(opened.Payload, payload) || opened.SSRC != 4242 || opened.SequenceNumber != 77 || opened.Timestamp != 960 || !opened.Marker {
				t.Fatalf("round trip changed the packet: %+v", opened.Header)
			}
		})
	}
}

func TestOpenSkipsTheEncryptedExtensionBodyAndPadding(t *testing.T) {
	for _, mode := range []string{modeAES256GCM, modeXChaCha20Poly1305} {
		t.Run(mode, func(t *testing.T) {
			key := testKey(11)
			nc, err := newNativeCipher(mode, key)
			if err != nil {
				t.Fatal(err)
			}
			header := []byte{0xb0, 0x78, 0, 5, 0, 0, 3, 0xc0, 0, 0, 0x10, 0x92, 0xbe, 0xde, 0, 1}
			opus := []byte{9, 8, 7, 6}
			plain := append([]byte{0x10, 0xff, 0, 0}, opus...)
			plain = append(plain, 0, 0, 3)
			aead := independentAEAD(t, mode, key)
			nonce := make([]byte, aead.NonceSize())
			binary.BigEndian.PutUint32(nonce, 0x01020304)
			packet := aead.Seal(append([]byte{}, header...), nonce, plain, header)
			packet = append(packet, 1, 2, 3, 4)
			opened, err := nc.open(packet)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(opened.Payload, opus) {
				t.Fatalf("payload %x", opened.Payload)
			}
			if opened.SSRC != 0x1092 || opened.PayloadType != 120 || opened.SequenceNumber != 5 {
				t.Fatalf("header %+v", opened.Header)
			}
		})
	}
}

func TestOpenRefusesRtcpTamperingAndTheWrongKey(t *testing.T) {
	nc, _ := newNativeCipher(modeAES256GCM, testKey(1))
	other, _ := newNativeCipher(modeAES256GCM, testKey(2))
	sealed, _ := nc.seal(&rtp.Packet{Header: rtp.Header{SSRC: 1}, Payload: []byte{1, 2, 3}}, nativeOpusPayloadType, 1)
	if _, err := other.open(sealed); err == nil {
		t.Fatal("opened with the wrong key")
	}
	tampered := append([]byte{}, sealed...)
	tampered[13] ^= 1
	if _, err := nc.open(tampered); err == nil {
		t.Fatal("opened a tampered packet")
	}
	rtcpPacket := append([]byte{}, sealed...)
	rtcpPacket[1] = 201
	if _, err := nc.open(rtcpPacket); err == nil {
		t.Fatal("opened an RTCP packet as RTP")
	}
	for _, short := range [][]byte{nil, {0x80}, sealed[:15]} {
		if _, err := nc.open(short); err == nil {
			t.Fatalf("opened a %d byte packet", len(short))
		}
	}
	if _, err := newNativeCipher("xsalsa20_poly1305", testKey(1)); err == nil {
		t.Fatal("accepted an unsupported mode")
	}
}

func useTestIPC(t *testing.T) {
	t.Helper()
	server, client := net.Pipe()
	previous := ipcConn
	ipcConn = &IpcConnection{conn: server}
	go func() { _, _ = io.Copy(io.Discard, client) }()
	t.Cleanup(func() {
		ipcConn = previous
		_ = server.Close()
		_ = client.Close()
	})
}

func nativePeer(t *testing.T, id string, ssrc uint32, mode string, key []byte) *Peer {
	t.Helper()
	p := &Peer{id: id, sinks: map[uint32]*rtcpSink{}, rtxSequence: map[uint32]uint16{}, videoLoss: map[uint32]lossReport{}}
	sfu.AddPeer(p)
	t.Cleanup(func() { cleanupPeer(p) })
	if err := handleNative(p, SignalMessage{ClientID: id, SSRC: ssrc, Mode: mode, Key: key}, ""); err != nil {
		t.Fatal(err)
	}
	p.mu.Lock()
	p.isAudioPublished = true
	p.mu.Unlock()
	return p
}

func TestTwoNativeClientsHearEachOtherThroughTheSharedPort(t *testing.T) {
	useTestIPC(t)
	serverConn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer serverConn.Close()
	demux := native.attach(serverConn)
	iceTraffic := make(chan []byte, 4)
	go func() {
		buffer := make([]byte, 1500)
		for {
			n, _, err := demux.ReadFrom(buffer)
			if err != nil {
				return
			}
			iceTraffic <- append([]byte{}, buffer[:n]...)
		}
	}()

	aliceKey, bobKey := testKey(40), testKey(90)
	alice := nativePeer(t, "alice", 1001, modeAES256GCM, aliceKey)
	bob := nativePeer(t, "bob", 2002, modeXChaCha20Poly1305, bobKey)
	if err := sfu.Subscribe(bob, alice, "audio"); err != nil {
		t.Fatal(err)
	}

	aliceSocket, _ := net.DialUDP("udp4", nil, serverConn.LocalAddr().(*net.UDPAddr))
	defer aliceSocket.Close()
	bobSocket, _ := net.DialUDP("udp4", nil, serverConn.LocalAddr().(*net.UDPAddr))
	defer bobSocket.Close()

	for _, step := range []struct {
		socket *net.UDPConn
		ssrc   uint32
	}{{aliceSocket, 1001}, {bobSocket, 2002}} {
		if _, err := step.socket.Write(discoveryRequest(step.ssrc)); err != nil {
			t.Fatal(err)
		}
		_ = step.socket.SetReadDeadline(time.Now().Add(2 * time.Second))
		response := make([]byte, 128)
		n, err := step.socket.Read(response)
		if err != nil || n != discoveryPacketSize {
			t.Fatalf("no discovery response: %v %d", err, n)
		}
		local := step.socket.LocalAddr().(*net.UDPAddr)
		if port := binary.BigEndian.Uint16(response[72:74]); int(port) != local.Port {
			t.Fatalf("discovered port %d, socket is on %d", port, local.Port)
		}
	}

	aliceCipher, _ := newNativeCipher(modeAES256GCM, aliceKey)
	bobCipher, _ := newNativeCipher(modeXChaCha20Poly1305, bobKey)
	opus := []byte{0x78, 1, 2, 3, 4, 5}
	packet, _ := aliceCipher.seal(&rtp.Packet{Header: rtp.Header{SequenceNumber: 10, Timestamp: 480, SSRC: 1001}, Payload: opus}, nativeOpusPayloadType, 1)
	if _, err := aliceSocket.Write(packet); err != nil {
		t.Fatal(err)
	}

	_ = bobSocket.SetReadDeadline(time.Now().Add(2 * time.Second))
	received := make([]byte, 1500)
	n, err := bobSocket.Read(received)
	if err != nil {
		t.Fatalf("bob got nothing: %v", err)
	}
	heard, err := bobCipher.open(received[:n])
	if err != nil {
		t.Fatalf("bob could not decrypt: %v", err)
	}
	if !bytes.Equal(heard.Payload, opus) || heard.SSRC != 1001 || heard.SequenceNumber != 10 || heard.PayloadType != nativeOpusPayloadType {
		t.Fatalf("bob heard %+v %x", heard.Header, heard.Payload)
	}

	rtcpPacket := []byte{0x80, 201, 0, 1, 0, 0, 0x03, 0xe9}
	if _, err := aliceSocket.Write(rtcpPacket); err != nil {
		t.Fatal(err)
	}
	stranger, _ := net.DialUDP("udp4", nil, serverConn.LocalAddr().(*net.UDPAddr))
	defer stranger.Close()
	if _, err := stranger.Write([]byte("not native")); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-iceTraffic:
		if string(got) != "not native" {
			t.Fatalf("native traffic leaked to ICE: %x", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("traffic from an unknown address did not reach ICE")
	}

	bob.blockAudio.Store(false)
	alice.blockAudio.Store(true)
	silenced, _ := aliceCipher.seal(&rtp.Packet{Header: rtp.Header{SequenceNumber: 11, Timestamp: 960, SSRC: 1001}, Payload: opus}, nativeOpusPayloadType, 2)
	_, _ = aliceSocket.Write(silenced)
	_ = bobSocket.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, err := bobSocket.Read(received); err == nil {
		t.Fatal("a muted native publisher was forwarded")
	}
}

func TestWebRtcPublisherAudioReachesANativeSubscriber(t *testing.T) {
	useTestIPC(t)
	serverConn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer serverConn.Close()
	demux := native.attach(serverConn)
	go func() {
		buffer := make([]byte, 1500)
		for {
			if _, _, err := demux.ReadFrom(buffer); err != nil {
				return
			}
		}
	}()

	web := &Peer{id: "web", sinks: map[uint32]*rtcpSink{}, rtxSequence: map[uint32]uint16{}, videoLoss: map[uint32]lossReport{}, isAudioPublished: true}
	sfu.AddPeer(web)
	t.Cleanup(func() { cleanupPeer(web) })
	track := &PublishedTrack{
		ssrc:       777,
		kind:       "audio",
		key:        subscriptionKey(web.id, "audio"),
		publisher:  web,
		extensions: map[uint8]string{1: "urn:ietf:params:rtp-hdrext:ssrc-audio-level"},
		stop:       make(chan struct{}),
		cache:      newPacketCache(16),
		losses:     newLossTracker(),
	}
	web.audioPublished = track

	key := testKey(60)
	listener := nativePeer(t, "listener", 3003, modeAES256GCM, key)
	if err := sfu.Subscribe(listener, web, "audio"); err != nil {
		t.Fatal(err)
	}
	socket, _ := net.DialUDP("udp4", nil, serverConn.LocalAddr().(*net.UDPAddr))
	defer socket.Close()
	if _, err := socket.Write(discoveryRequest(3003)); err != nil {
		t.Fatal(err)
	}
	_ = socket.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := socket.Read(make([]byte, 128)); err != nil {
		t.Fatalf("no discovery response: %v", err)
	}

	opus := []byte{0xfc, 0xff, 0xfe, 0x42}
	pkt := &rtp.Packet{Header: rtp.Header{Version: 2, PayloadType: 111, SequenceNumber: 500, Timestamp: 48000, SSRC: 777}, Payload: opus}
	if err := pkt.SetExtension(1, []byte{0x90}); err != nil {
		t.Fatal(err)
	}
	track.ingest(pkt)

	received := make([]byte, 1500)
	_ = socket.SetReadDeadline(time.Now().Add(2 * time.Second))
	n, err := socket.Read(received)
	if err != nil {
		t.Fatalf("the native listener got nothing: %v", err)
	}
	listenerCipher, _ := newNativeCipher(modeAES256GCM, key)
	heard, err := listenerCipher.open(received[:n])
	if err != nil {
		t.Fatalf("could not decrypt: %v", err)
	}
	if heard.SSRC != 777 || heard.PayloadType != nativeOpusPayloadType || received[0]&0x10 != 0 || !bytes.Equal(heard.Payload, opus) {
		t.Fatalf("listener heard %+v %x", heard.Header, heard.Payload)
	}

	listener.deaf.Store(true)
	track.ingest(&rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: 501, SSRC: 777}, Payload: opus})
	_ = socket.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, err := socket.Read(received); err == nil {
		t.Fatal("a deafened native listener still got audio")
	}
}
