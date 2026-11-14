package main

import (
	"bytes"
	"encoding/binary"
	"net"
	"testing"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/rtp"
)

type nativeEndpoint struct {
	t      *testing.T
	peer   *Peer
	socket *net.UDPConn
	cipher *nativeCipher
}

func nativeServer(t *testing.T) *net.UDPConn {
	t.Helper()
	useTestIPC(t)
	serverConn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = serverConn.Close() })
	demux := native.attach(serverConn)
	go func() {
		buffer := make([]byte, 1500)
		for {
			if _, _, err := demux.ReadFrom(buffer); err != nil {
				return
			}
		}
	}()
	return serverConn
}

func joinNative(t *testing.T, server *net.UDPConn, id string, ssrc uint32, mode string, key []byte, video, rtx uint8) *nativeEndpoint {
	t.Helper()
	p := &Peer{id: id, sinks: map[uint32]*rtcpSink{}, rtxSequence: map[uint32]uint16{}, videoLoss: map[uint32]lossReport{}}
	sfu.AddPeer(p)
	t.Cleanup(func() { cleanupPeer(p) })
	msg := SignalMessage{ClientID: id, SSRC: ssrc, Mode: mode, Key: key, AudioPayloadType: 120, VideoPayloadType: video, RtxPayloadType: rtx}
	if err := handleNative(p, msg, ""); err != nil {
		t.Fatal(err)
	}
	socket, err := net.DialUDP("udp4", nil, server.LocalAddr().(*net.UDPAddr))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = socket.Close() })
	if _, err := socket.Write(discoveryRequest(ssrc)); err != nil {
		t.Fatal(err)
	}
	_ = socket.SetReadDeadline(time.Now().Add(2 * time.Second))
	if _, err := socket.Read(make([]byte, 128)); err != nil {
		t.Fatalf("%s got no discovery response: %v", id, err)
	}
	nc, _ := newNativeCipher(mode, key)
	return &nativeEndpoint{t: t, peer: p, socket: socket, cipher: nc}
}

func (e *nativeEndpoint) publishVideo(ssrc, rtx uint32) {
	e.t.Helper()
	if err := handlePublish(e.peer, SignalMessage{ClientID: e.peer.id, TrackType: "video", SSRC: ssrc, RtxSSRC: rtx}); err != nil {
		e.t.Fatal(err)
	}
}

func (e *nativeEndpoint) sendRTP(pkt *rtp.Packet, counter uint32) {
	e.t.Helper()
	out, err := e.cipher.seal(pkt, pkt.PayloadType, counter)
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.socket.Write(out); err != nil {
		e.t.Fatal(err)
	}
}

func (e *nativeEndpoint) sendRTCP(packets []rtcp.Packet, counter uint32) {
	e.t.Helper()
	out, err := e.cipher.sealRTCP(packets, counter)
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := e.socket.Write(out); err != nil {
		e.t.Fatal(err)
	}
}

func (e *nativeEndpoint) next(timeout time.Duration) []byte {
	buffer := make([]byte, 1500)
	_ = e.socket.SetReadDeadline(time.Now().Add(timeout))
	n, err := e.socket.Read(buffer)
	if err != nil {
		return nil
	}
	return buffer[:n]
}

func (e *nativeEndpoint) nextRTP(timeout time.Duration) *rtp.Packet {
	e.t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		packet := e.next(time.Until(deadline))
		if packet == nil {
			break
		}
		if isRTCPPacketType(packet[1]) {
			continue
		}
		pkt, err := e.cipher.open(packet)
		if err != nil {
			e.t.Fatalf("%s could not decrypt RTP: %v", e.peer.id, err)
		}
		return pkt
	}
	return nil
}

func (e *nativeEndpoint) nextRTCP(timeout time.Duration, match func(rtcp.Packet) bool) rtcp.Packet {
	e.t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		packet := e.next(time.Until(deadline))
		if packet == nil {
			break
		}
		if !isRTCPPacketType(packet[1]) {
			continue
		}
		packets, err := e.cipher.openRTCP(packet)
		if err != nil {
			e.t.Fatalf("%s could not decrypt RTCP: %v", e.peer.id, err)
		}
		for _, p := range packets {
			if match(p) {
				return p
			}
		}
	}
	return nil
}

func h264Packet(ssrc uint32, payloadType uint8, seq uint16, payload []byte) *rtp.Packet {
	return &rtp.Packet{Header: rtp.Header{Version: 2, Marker: true, PayloadType: payloadType, SequenceNumber: seq, Timestamp: uint32(seq) * 3000, SSRC: ssrc}, Payload: payload}
}

func TestSealedRtcpKeepsTheHeaderInTheClear(t *testing.T) {
	for _, mode := range []string{modeAES256GCM, modeXChaCha20Poly1305} {
		t.Run(mode, func(t *testing.T) {
			key := testKey(7)
			nc, _ := newNativeCipher(mode, key)
			out, err := nc.sealRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{SenderSSRC: 11, MediaSSRC: 22}}, 5)
			if err != nil {
				t.Fatal(err)
			}
			if out[1] != 206 || binary.BigEndian.Uint32(out[4:8]) != 11 {
				t.Fatalf("header %x", out[:8])
			}
			aead := independentAEAD(t, mode, key)
			nonce := make([]byte, aead.NonceSize())
			binary.BigEndian.PutUint32(nonce, 5)
			plain, err := aead.Open(nil, nonce, out[8:len(out)-4], out[:8])
			if err != nil || binary.BigEndian.Uint32(plain) != 22 {
				t.Fatalf("independent decrypt failed: %v %x", err, plain)
			}
			packets, err := nc.openRTCP(out)
			if err != nil {
				t.Fatal(err)
			}
			if pli, ok := packets[0].(*rtcp.PictureLossIndication); !ok || pli.MediaSSRC != 22 {
				t.Fatalf("round trip gave %#v", packets[0])
			}
			tampered := append([]byte{}, out...)
			tampered[5] ^= 1
			if _, err := nc.openRTCP(tampered); err == nil {
				t.Fatal("opened RTCP with a tampered header")
			}
		})
	}
}

func TestNativeVideoReachesANativeViewerUntouched(t *testing.T) {
	server := nativeServer(t)
	streamer := joinNative(t, server, "streamer", 4001, modeAES256GCM, testKey(20), 101, 102)
	viewer := joinNative(t, server, "viewer", 5001, modeXChaCha20Poly1305, testKey(50), 103, 104)
	streamer.publishVideo(4002, 4003)
	if err := sfu.Subscribe(viewer.peer, streamer.peer, "video"); err != nil {
		t.Fatal(err)
	}
	if pli := streamer.nextRTCP(time.Second, func(p rtcp.Packet) bool { _, ok := p.(*rtcp.PictureLossIndication); return ok }); pli == nil {
		t.Fatal("publishing did not ask the streamer for a keyframe")
	}

	daveFrame := []byte{0x7c, 0x85, 1, 2, 3, 4, 5, 6, 7, 8, 0x0a, 0xfa, 0xfa}
	streamer.sendRTP(h264Packet(4002, 101, 300, daveFrame), 1)
	got := viewer.nextRTP(2 * time.Second)
	if got == nil {
		t.Fatal("the viewer got no video")
	}
	if got.SSRC != 4002 || got.PayloadType != 103 || got.SequenceNumber != 300 || got.Timestamp != 900000 || !got.Marker || !bytes.Equal(got.Payload, daveFrame) {
		t.Fatalf("viewer got %+v %x", got.Header, got.Payload)
	}

	streamer.sendRTP(h264Packet(4002, 96, 301, daveFrame), 2)
	if got := viewer.nextRTP(300 * time.Millisecond); got != nil {
		t.Fatalf("video in another codec was forwarded: %+v", got.Header)
	}
	client := streamer.peer.native.Load()
	if client.wrongCodec.Load() != 1 {
		t.Fatalf("wrong codec count %d", client.wrongCodec.Load())
	}

	repaired := append([]byte{0x01, 0x2e}, daveFrame...)
	streamer.sendRTP(&rtp.Packet{Header: rtp.Header{Version: 2, PayloadType: 102, SequenceNumber: 9000, Timestamp: 903000, SSRC: 4003}, Payload: repaired}, 3)
	got = viewer.nextRTP(2 * time.Second)
	if got == nil || got.SSRC != 4002 || got.SequenceNumber != 302 || got.PayloadType != 103 || !bytes.Equal(got.Payload, daveFrame) {
		t.Fatalf("the retransmission was not unwrapped into the stream: %+v", got)
	}
}

func TestNativeViewerFeedbackReachesTheNativeStreamer(t *testing.T) {
	server := nativeServer(t)
	streamer := joinNative(t, server, "streamer", 6001, modeXChaCha20Poly1305, testKey(30), 101, 102)
	viewer := joinNative(t, server, "viewer", 7001, modeAES256GCM, testKey(70), 101, 102)
	streamer.publishVideo(6002, 6003)
	if err := sfu.Subscribe(viewer.peer, streamer.peer, "video"); err != nil {
		t.Fatal(err)
	}
	streamer.nextRTCP(time.Second, func(p rtcp.Packet) bool { _, ok := p.(*rtcp.PictureLossIndication); return ok })

	frame := []byte{0x65, 0x88, 0x84, 0x21}
	streamer.sendRTP(h264Packet(6002, 101, 40, frame), 1)
	if viewer.nextRTP(2*time.Second) == nil {
		t.Fatal("the viewer got no video")
	}

	time.Sleep(600 * time.Millisecond)
	viewer.sendRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{SenderSSRC: 7001, MediaSSRC: 6002}}, 1)
	pli := streamer.nextRTCP(2*time.Second, func(p rtcp.Packet) bool { _, ok := p.(*rtcp.PictureLossIndication); return ok })
	if pli == nil || pli.(*rtcp.PictureLossIndication).MediaSSRC != 6002 {
		t.Fatalf("the streamer got no keyframe request: %#v", pli)
	}

	viewer.sendRTCP([]rtcp.Packet{&rtcp.TransportLayerNack{SenderSSRC: 7001, MediaSSRC: 6002, Nacks: rtcp.NackPairsFromSequenceNumbers([]uint16{40})}}, 2)
	repair := viewer.nextRTP(2 * time.Second)
	if repair == nil || repair.SSRC != 6003 || repair.PayloadType != 102 || binary.BigEndian.Uint16(repair.Payload) != 40 || !bytes.Equal(repair.Payload[2:], frame) {
		t.Fatalf("the viewer got no RTX repair: %+v", repair)
	}

	streamer.sendRTP(h264Packet(6002, 101, 43, frame), 2)
	nack := streamer.nextRTCP(2*time.Second, func(p rtcp.Packet) bool { _, ok := p.(*rtcp.TransportLayerNack); return ok })
	if nack == nil {
		t.Fatal("the streamer was not asked to resend a lost packet")
	}
	lost := nack.(*rtcp.TransportLayerNack).Nacks[0].PacketList()
	if nack.(*rtcp.TransportLayerNack).MediaSSRC != 6002 || len(lost) != 2 || lost[0] != 41 || lost[1] != 42 {
		t.Fatalf("nack %+v", nack)
	}
	if streamer.peer.native.Load().rtcpSent.Load() == 0 || viewer.peer.native.Load().rtcpHandled.Load() != 2 {
		t.Fatal("RTCP counters did not move")
	}
}

func TestReceptionReportsCountLossAcrossTheSequenceWrap(t *testing.T) {
	p := &Peer{id: "reporter", isVideoPublished: true}
	pt := &PublishedTrack{ssrc: 99, kind: "video", publisher: p, stop: make(chan struct{}), cache: newPacketCache(64), losses: newLossTracker()}
	for _, seq := range []uint16{65533, 65534, 0, 1} {
		pt.ingest(&rtp.Packet{Header: rtp.Header{SequenceNumber: seq, SSRC: 99}, Payload: []byte{1}})
	}
	report, ok := pt.receptionReport()
	if !ok || report.SSRC != 99 || report.LastSequenceNumber != 1<<16|1 || report.TotalLost != 1 || report.FractionLost != 51 {
		t.Fatalf("report %+v", report)
	}
	pt.ingest(&rtp.Packet{Header: rtp.Header{SequenceNumber: 2, SSRC: 99}, Payload: []byte{1}})
	report, _ = pt.receptionReport()
	if report.TotalLost != 1 || report.FractionLost != 0 || report.LastSequenceNumber != 1<<16|2 {
		t.Fatalf("second report %+v", report)
	}
}

func TestWebRtcVideoReachesANativeViewer(t *testing.T) {
	server := nativeServer(t)
	web := &Peer{id: "web", sinks: map[uint32]*rtcpSink{}, rtxSequence: map[uint32]uint16{}, videoLoss: map[uint32]lossReport{}, isVideoPublished: true}
	sfu.AddPeer(web)
	t.Cleanup(func() { cleanupPeer(web) })
	track := &PublishedTrack{
		ssrc:       0x5eed,
		kind:       "video",
		key:        subscriptionKey(web.id, "video"),
		publisher:  web,
		extensions: map[uint8]string{3: "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time"},
		stop:       make(chan struct{}),
		cache:      newPacketCache(64),
		losses:     newLossTracker(),
	}
	web.videoPublished = track
	viewer := joinNative(t, server, "viewer", 8001, modeAES256GCM, testKey(80), 105, 106)
	if err := sfu.Subscribe(viewer.peer, web, "video"); err != nil {
		t.Fatal(err)
	}

	frame := []byte{0x7c, 0x05, 9, 9, 9}
	pkt := h264Packet(0x5eed, 103, 10, frame)
	if err := pkt.SetExtension(3, []byte{1, 2, 3}); err != nil {
		t.Fatal(err)
	}
	track.ingest(pkt)
	got := viewer.nextRTP(2 * time.Second)
	if got == nil || got.SSRC != 0x5eed || got.PayloadType != 105 || !bytes.Equal(got.Payload, frame) {
		t.Fatalf("viewer got %+v", got)
	}
	track.ingest(&rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: 11, SSRC: 0x5eed, PayloadType: 103}})
	if got := viewer.nextRTP(300 * time.Millisecond); got != nil {
		t.Fatalf("an empty padding packet was forwarded: %+v", got.Header)
	}

	web.blockVideo.Store(true)
	track.ingest(h264Packet(0x5eed, 103, 12, frame))
	if got := viewer.nextRTP(300 * time.Millisecond); got != nil {
		t.Fatal("blocked video reached the native viewer")
	}
}
