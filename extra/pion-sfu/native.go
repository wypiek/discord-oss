package main

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"errors"
	"fmt"
	"log"
	"net"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"golang.org/x/crypto/chacha20poly1305"
)

const (
	modeAES256GCM          = "aead_aes256_gcm_rtpsize"
	modeXChaCha20Poly1305  = "aead_xchacha20_poly1305_rtpsize"
	discoveryRequestType   = 0x1
	discoveryResponseType  = 0x2
	discoveryPacketSize    = 74
	discoveryBodyLength    = 70
	discoveryAddressLength = 64
	nativeOpusPayloadType  = 120
	nativeH264PayloadType  = 101
	nativeRTXPayloadType   = 102
	nativeNonceSuffix      = 4
	rtcpHeaderLength       = 8
)

var errNativePacket = errors.New("not a decryptable native packet")

type nativeCipher struct {
	aead      cipher.AEAD
	nonceSize int
}

func newNativeCipher(mode string, key []byte) (*nativeCipher, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("key must be 32 bytes, got %d", len(key))
	}
	switch mode {
	case modeAES256GCM:
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, err
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, err
		}
		return &nativeCipher{aead: aead, nonceSize: aead.NonceSize()}, nil
	case modeXChaCha20Poly1305:
		aead, err := chacha20poly1305.NewX(key)
		if err != nil {
			return nil, err
		}
		return &nativeCipher{aead: aead, nonceSize: aead.NonceSize()}, nil
	default:
		return nil, fmt.Errorf("unsupported encryption mode %q", mode)
	}
}

func (c *nativeCipher) nonce(counter []byte) []byte {
	nonce := make([]byte, c.nonceSize)
	copy(nonce, counter)
	return nonce
}

func unencryptedHeaderLength(packet []byte) int {
	length := 12 + 4*int(packet[0]&0x0f)
	if packet[0]&0x10 != 0 {
		length += 4
	}
	return length
}

func isRTCPPacketType(packetType byte) bool {
	return packetType >= 192 && packetType <= 223
}

func (c *nativeCipher) open(packet []byte) (*rtp.Packet, error) {
	if len(packet) < 12 || packet[0]>>6 != 2 || isRTCPPacketType(packet[1]) {
		return nil, errNativePacket
	}
	headerLength := unencryptedHeaderLength(packet)
	if len(packet) < headerLength+c.aead.Overhead()+nativeNonceSuffix {
		return nil, errNativePacket
	}
	header := packet[:headerLength]
	sealed := packet[headerLength : len(packet)-nativeNonceSuffix]
	plain, err := c.aead.Open(nil, c.nonce(packet[len(packet)-nativeNonceSuffix:]), sealed, header)
	if err != nil {
		return nil, errNativePacket
	}
	if packet[0]&0x10 != 0 {
		extensionBody := int(binary.BigEndian.Uint16(header[headerLength-2:])) * 4
		if extensionBody > len(plain) {
			return nil, errNativePacket
		}
		plain = plain[extensionBody:]
	}
	if packet[0]&0x20 != 0 && len(plain) > 0 {
		padding := int(plain[len(plain)-1])
		if padding > len(plain) {
			return nil, errNativePacket
		}
		plain = plain[:len(plain)-padding]
	}
	return &rtp.Packet{
		Header: rtp.Header{
			Version:        2,
			Marker:         packet[1]&0x80 != 0,
			PayloadType:    packet[1] & 0x7f,
			SequenceNumber: binary.BigEndian.Uint16(packet[2:4]),
			Timestamp:      binary.BigEndian.Uint32(packet[4:8]),
			SSRC:           binary.BigEndian.Uint32(packet[8:12]),
		},
		Payload: plain,
	}, nil
}

func (c *nativeCipher) seal(pkt *rtp.Packet, payloadType uint8, counter uint32) ([]byte, error) {
	header := rtp.Header{
		Version:        2,
		Marker:         pkt.Marker,
		PayloadType:    payloadType,
		SequenceNumber: pkt.SequenceNumber,
		Timestamp:      pkt.Timestamp,
		SSRC:           pkt.SSRC,
	}
	headerBytes, err := header.Marshal()
	if err != nil {
		return nil, err
	}
	suffix := make([]byte, nativeNonceSuffix)
	binary.BigEndian.PutUint32(suffix, counter)
	out := make([]byte, 0, len(headerBytes)+len(pkt.Payload)+c.aead.Overhead()+nativeNonceSuffix)
	out = append(out, headerBytes...)
	out = c.aead.Seal(out, c.nonce(suffix), pkt.Payload, headerBytes)
	return append(out, suffix...), nil
}

func (c *nativeCipher) openRTCP(packet []byte) ([]rtcp.Packet, error) {
	if len(packet) < rtcpHeaderLength+c.aead.Overhead()+nativeNonceSuffix || packet[0]>>6 != 2 || !isRTCPPacketType(packet[1]) {
		return nil, errNativePacket
	}
	header := packet[:rtcpHeaderLength]
	sealed := packet[rtcpHeaderLength : len(packet)-nativeNonceSuffix]
	plain, err := c.aead.Open(nil, c.nonce(packet[len(packet)-nativeNonceSuffix:]), sealed, header)
	if err != nil {
		return nil, errNativePacket
	}
	compound := append(append(make([]byte, 0, rtcpHeaderLength+len(plain)), header...), plain...)
	packets, err := rtcp.Unmarshal(compound)
	if err == nil {
		return packets, nil
	}
	if len(compound)%4 != 0 {
		return nil, errNativePacket
	}
	binary.BigEndian.PutUint16(compound[2:4], uint16(len(compound)/4-1))
	return rtcp.Unmarshal(compound)
}

func (c *nativeCipher) sealRTCP(packets []rtcp.Packet, counter uint32) ([]byte, error) {
	raw, err := rtcp.Marshal(packets)
	if err != nil {
		return nil, err
	}
	if len(raw) < rtcpHeaderLength {
		return nil, errNativePacket
	}
	suffix := make([]byte, nativeNonceSuffix)
	binary.BigEndian.PutUint32(suffix, counter)
	out := make([]byte, 0, len(raw)+c.aead.Overhead()+nativeNonceSuffix)
	out = append(out, raw[:rtcpHeaderLength]...)
	out = c.aead.Seal(out, c.nonce(suffix), raw[rtcpHeaderLength:], raw[:rtcpHeaderLength])
	return append(out, suffix...), nil
}

func isDiscoveryRequest(packet []byte) bool {
	return len(packet) == discoveryPacketSize &&
		binary.BigEndian.Uint16(packet[0:2]) == discoveryRequestType &&
		binary.BigEndian.Uint16(packet[2:4]) == discoveryBodyLength
}

func discoveryResponse(ssrc uint32, addr *net.UDPAddr) []byte {
	response := make([]byte, discoveryPacketSize)
	binary.BigEndian.PutUint16(response[0:2], discoveryResponseType)
	binary.BigEndian.PutUint16(response[2:4], discoveryBodyLength)
	binary.BigEndian.PutUint32(response[4:8], ssrc)
	ip := addr.IP.String()
	if v4 := addr.IP.To4(); v4 != nil {
		ip = v4.String()
	}
	copy(response[8:8+discoveryAddressLength-1], ip)
	binary.BigEndian.PutUint16(response[8+discoveryAddressLength:], uint16(addr.Port))
	return response
}

type nativePayloadTypes struct {
	audio uint8
	video uint8
	rtx   uint8
}

type nativeVideo struct {
	track   *PublishedTrack
	rtxSSRC uint32
}

type nativeClient struct {
	peer     *Peer
	ssrc     uint32
	cipher   *nativeCipher
	payloads nativePayloadTypes
	track    *PublishedTrack
	video    atomic.Pointer[nativeVideo]
	addr     atomic.Pointer[net.UDPAddr]
	counter  atomic.Uint32
	extra    []uint32

	packets       atomic.Uint64
	rtcp          atomic.Uint64
	rtcpHandled   atomic.Uint64
	foreignSSRC   atomic.Uint64
	undecryptable atomic.Uint64
	videoPackets  atomic.Uint64
	rtxPackets    atomic.Uint64
	wrongCodec    atomic.Uint64
	videoSent     atomic.Uint64
	rtcpSent      atomic.Uint64
}

type nativeTransport struct {
	mu         sync.RWMutex
	conn       net.PacketConn
	bySSRC     map[uint32]*nativeClient
	byAddr     map[string]*nativeClient
	discovered map[uint32]*net.UDPAddr
}

var native = newNativeTransport()

func newNativeTransport() *nativeTransport {
	return &nativeTransport{
		bySSRC:     make(map[uint32]*nativeClient),
		byAddr:     make(map[string]*nativeClient),
		discovered: make(map[uint32]*net.UDPAddr),
	}
}

func (t *nativeTransport) attach(conn net.PacketConn) net.PacketConn {
	t.mu.Lock()
	t.conn = conn
	t.mu.Unlock()
	return &nativeDemuxConn{PacketConn: conn, transport: t}
}

func (t *nativeTransport) register(client *nativeClient) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if previous := t.bySSRC[client.ssrc]; previous != nil {
		t.forgetLocked(previous)
	}
	t.bySSRC[client.ssrc] = client
	if addr := t.discovered[client.ssrc]; addr != nil {
		delete(t.discovered, client.ssrc)
		client.addr.Store(addr)
		t.byAddr[addr.String()] = client
	}
}

func (t *nativeTransport) claim(client *nativeClient, ssrcs ...uint32) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.bySSRC[client.ssrc] != client {
		return
	}
	for _, ssrc := range client.extra {
		if t.bySSRC[ssrc] == client {
			delete(t.bySSRC, ssrc)
		}
	}
	client.extra = client.extra[:0]
	for _, ssrc := range ssrcs {
		if ssrc == 0 || ssrc == client.ssrc {
			continue
		}
		if owner := t.bySSRC[ssrc]; owner != nil && owner != client {
			continue
		}
		t.bySSRC[ssrc] = client
		client.extra = append(client.extra, ssrc)
	}
}

func (t *nativeTransport) remove(client *nativeClient) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.bySSRC[client.ssrc] == client {
		t.forgetLocked(client)
	}
}

func (t *nativeTransport) forgetLocked(client *nativeClient) {
	delete(t.bySSRC, client.ssrc)
	for _, ssrc := range client.extra {
		if t.bySSRC[ssrc] == client {
			delete(t.bySSRC, ssrc)
		}
	}
	client.extra = nil
	if addr := client.addr.Load(); addr != nil && t.byAddr[addr.String()] == client {
		delete(t.byAddr, addr.String())
	}
}

func (t *nativeTransport) bind(client *nativeClient, addr *net.UDPAddr) {
	if previous := client.addr.Load(); previous != nil && previous.String() == addr.String() {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if previous := client.addr.Load(); previous != nil && t.byAddr[previous.String()] == client {
		delete(t.byAddr, previous.String())
	}
	client.addr.Store(addr)
	t.byAddr[addr.String()] = client
}

func (t *nativeTransport) handle(packet []byte, from net.Addr) bool {
	addr, ok := from.(*net.UDPAddr)
	if !ok {
		return false
	}
	if isDiscoveryRequest(packet) {
		t.answerDiscovery(binary.BigEndian.Uint32(packet[4:8]), addr)
		return true
	}
	t.mu.RLock()
	client := t.byAddr[addr.String()]
	if client == nil && len(packet) >= 12 && packet[0]>>6 == 2 {
		if isRTCPPacketType(packet[1]) {
			client = t.bySSRC[binary.BigEndian.Uint32(packet[4:8])]
		} else {
			client = t.bySSRC[binary.BigEndian.Uint32(packet[8:12])]
		}
	}
	t.mu.RUnlock()
	if client == nil {
		return false
	}
	client.receive(packet, addr)
	return true
}

func (t *nativeTransport) answerDiscovery(ssrc uint32, addr *net.UDPAddr) {
	t.mu.Lock()
	if client := t.bySSRC[ssrc]; client != nil {
		if previous := client.addr.Load(); previous != nil && t.byAddr[previous.String()] == client {
			delete(t.byAddr, previous.String())
		}
		client.addr.Store(addr)
		t.byAddr[addr.String()] = client
	} else {
		if len(t.discovered) > 4096 {
			clear(t.discovered)
		}
		t.discovered[ssrc] = addr
	}
	conn := t.conn
	t.mu.Unlock()
	if conn != nil {
		_, _ = conn.WriteTo(discoveryResponse(ssrc, addr), addr)
	}
}

func (t *nativeTransport) write(packet []byte, addr *net.UDPAddr) {
	t.mu.RLock()
	conn := t.conn
	t.mu.RUnlock()
	if conn != nil {
		_, _ = conn.WriteTo(packet, addr)
	}
}

func (c *nativeClient) receive(packet []byte, from *net.UDPAddr) {
	c.packets.Add(1)
	if len(packet) < rtcpHeaderLength || packet[0]>>6 != 2 {
		return
	}
	if isRTCPPacketType(packet[1]) {
		c.rtcp.Add(1)
		packets, err := c.cipher.openRTCP(packet)
		if err != nil {
			c.undecryptable.Add(1)
			return
		}
		native.bind(c, from)
		c.rtcpHandled.Add(1)
		c.peer.handleSubscriberRTCP(packets)
		return
	}
	if len(packet) < 12 {
		return
	}
	ssrc := binary.BigEndian.Uint32(packet[8:12])
	video := c.video.Load()
	isVideo := video != nil && ssrc == uint32(video.track.ssrc)
	isRTX := video != nil && video.rtxSSRC != 0 && ssrc == video.rtxSSRC
	if ssrc != c.ssrc && !isVideo && !isRTX {
		c.foreignSSRC.Add(1)
		return
	}
	pkt, err := c.cipher.open(packet)
	if err != nil {
		c.undecryptable.Add(1)
		return
	}
	native.bind(c, from)
	switch {
	case isVideo:
		if len(pkt.Payload) > 0 && pkt.PayloadType != c.payloads.video {
			c.wrongCodec.Add(1)
			return
		}
		c.videoPackets.Add(1)
		video.track.ingest(pkt)
	case isRTX:
		if len(pkt.Payload) < 2 {
			return
		}
		c.rtxPackets.Add(1)
		repaired := &rtp.Packet{Header: pkt.Header, Payload: pkt.Payload[2:]}
		repaired.SSRC = uint32(video.track.ssrc)
		repaired.PayloadType = c.payloads.video
		repaired.SequenceNumber = binary.BigEndian.Uint16(pkt.Payload[:2])
		video.track.ingest(repaired)
	default:
		if c.track != nil {
			c.track.ingest(pkt)
		}
	}
}

func (c *nativeClient) seal(pkt *rtp.Packet, payloadType uint8) {
	addr := c.addr.Load()
	if addr == nil {
		return
	}
	out, err := c.cipher.seal(pkt, payloadType, c.counter.Add(1))
	if err != nil {
		return
	}
	native.write(out, addr)
}

func (c *nativeClient) send(pt *PublishedTrack, pkt *rtp.Packet) {
	if pt.kind == "audio" {
		c.seal(pkt, c.payloads.audio)
		return
	}
	if len(pkt.Payload) == 0 {
		return
	}
	c.videoSent.Add(1)
	c.seal(pkt, c.payloads.video)
}

func (c *nativeClient) retransmit(pt *PublishedTrack, pkt *rtp.Packet) {
	if pt.kind == "audio" || c.payloads.rtx == 0 {
		c.send(pt, pkt)
		return
	}
	rtxSSRC := uint32(pt.ssrc) + 1
	payload := make([]byte, 2+len(pkt.Payload))
	binary.BigEndian.PutUint16(payload, pkt.SequenceNumber)
	copy(payload[2:], pkt.Payload)
	repair := &rtp.Packet{Header: pkt.Header, Payload: payload}
	repair.SSRC = rtxSSRC
	repair.SequenceNumber = c.peer.nextRTXSequence(rtxSSRC)
	c.seal(repair, c.payloads.rtx)
}

func (c *nativeClient) sendRTCP(packets []rtcp.Packet) error {
	addr := c.addr.Load()
	if addr == nil {
		return nil
	}
	out, err := c.cipher.sealRTCP(packets, c.counter.Add(1))
	if err != nil {
		return err
	}
	c.rtcpSent.Add(1)
	native.write(out, addr)
	return nil
}

func (c *nativeClient) publishVideo(ssrc, rtxSSRC uint32) error {
	if ssrc == 0 {
		return fmt.Errorf("missing video ssrc")
	}
	p := c.peer
	if current := c.video.Load(); current != nil && uint32(current.track.ssrc) == ssrc && current.rtxSSRC == rtxSSRC {
		current.track.requestKeyframe()
		return nil
	}
	track := &PublishedTrack{
		ssrc:       webrtc.SSRC(ssrc),
		kind:       "video",
		key:        subscriptionKey(p.id, "video"),
		publisher:  p,
		extensions: map[uint8]string{},
		stop:       make(chan struct{}),
		cache:      newPacketCache(2048),
		losses:     newLossTracker(),
	}
	p.mu.Lock()
	previous := p.videoPublished
	p.videoPublished = track
	p.mu.Unlock()
	if previous != nil {
		previous.close()
	}
	c.video.Store(&nativeVideo{track: track, rtxSSRC: rtxSSRC})
	native.claim(c, ssrc, rtxSSRC)
	for _, other := range sfu.Subscribers(track.key) {
		other.ensureSinks(track)
	}
	log.Printf("Client %s started publishing native video (SSRC: %d, RTX: %d)", p.id, ssrc, rtxSSRC)
	track.requestKeyframe()
	go track.requestRetransmissions()
	return nil
}

func (sub *Peer) subscribedTrack(ssrc uint32) *PublishedTrack {
	for _, publisher := range sfu.PeerSnapshot() {
		if publisher == sub {
			continue
		}
		publisher.mu.Lock()
		tracks := []*PublishedTrack{publisher.audioPublished, publisher.videoPublished}
		publisher.mu.Unlock()
		for _, pt := range tracks {
			if pt != nil && (uint32(pt.ssrc) == ssrc || (pt.kind == "video" && uint32(pt.ssrc)+1 == ssrc)) && sfu.IsSubscribed(sub, pt.key) {
				return pt
			}
		}
	}
	return nil
}

func (sub *Peer) handleSubscriberRTCP(packets []rtcp.Packet) {
	for _, packet := range packets {
		switch pkt := packet.(type) {
		case *rtcp.PictureLossIndication:
			if pt := sub.subscribedTrack(pkt.MediaSSRC); pt != nil {
				pt.requestKeyframe()
			}
		case *rtcp.FullIntraRequest:
			for _, entry := range pkt.FIR {
				if pt := sub.subscribedTrack(entry.SSRC); pt != nil {
					pt.requestKeyframe()
				}
			}
		case *rtcp.TransportLayerNack:
			if pt := sub.subscribedTrack(pkt.MediaSSRC); pt != nil && uint32(pt.ssrc) == pkt.MediaSSRC {
				sub.retransmit(pt, pkt)
			}
		case *rtcp.ReceiverEstimatedMaximumBitrate:
			sub.mu.Lock()
			sub.remb = pkt.Bitrate
			sub.rembAt = time.Now()
			sub.mu.Unlock()
		case *rtcp.ReceiverReport:
			sub.recordNativeLoss(pkt.Reports)
		case *rtcp.SenderReport:
			sub.recordNativeLoss(pkt.Reports)
		}
	}
}

func (sub *Peer) recordNativeLoss(reports []rtcp.ReceptionReport) {
	for _, report := range reports {
		if pt := sub.subscribedTrack(report.SSRC); pt != nil {
			sub.recordLoss(pt, report.SSRC, []rtcp.ReceptionReport{report})
		}
	}
}

func (p *Peer) writeRTCP(packets []rtcp.Packet) error {
	if client := p.native.Load(); client != nil {
		return client.sendRTCP(packets)
	}
	if p.pc == nil {
		return fmt.Errorf("client %s has no peer connection", p.id)
	}
	return p.pc.WriteRTCP(packets)
}

type nativeDemuxConn struct {
	net.PacketConn
	transport *nativeTransport
}

func (c *nativeDemuxConn) ReadFrom(b []byte) (int, net.Addr, error) {
	for {
		n, addr, err := c.PacketConn.ReadFrom(b)
		if err != nil || !c.transport.handle(b[:n], addr) {
			return n, addr, err
		}
	}
}

func payloadTypeOr(value, fallback uint8) uint8 {
	if value == 0 || value > 127 {
		return fallback
	}
	return value
}

func handleNative(p *Peer, msg SignalMessage, requestID string) error {
	if msg.SSRC == 0 {
		return fmt.Errorf("missing ssrc")
	}
	nc, err := newNativeCipher(msg.Mode, msg.Key)
	if err != nil {
		return err
	}
	if p.native.Load() != nil {
		return fmt.Errorf("client %s is already native", p.id)
	}
	client := &nativeClient{
		peer:   p,
		ssrc:   msg.SSRC,
		cipher: nc,
		payloads: nativePayloadTypes{
			audio: payloadTypeOr(msg.AudioPayloadType, nativeOpusPayloadType),
			video: payloadTypeOr(msg.VideoPayloadType, nativeH264PayloadType),
			rtx:   payloadTypeOr(msg.RtxPayloadType, nativeRTXPayloadType),
		},
	}
	track := &PublishedTrack{
		ssrc:       webrtc.SSRC(msg.SSRC),
		kind:       "audio",
		key:        subscriptionKey(p.id, "audio"),
		publisher:  p,
		extensions: map[uint8]string{},
		stop:       make(chan struct{}),
		cache:      newPacketCache(512),
		losses:     newLossTracker(),
	}
	client.track = track

	p.mu.Lock()
	previous := p.audioPublished
	p.audioPublished = track
	transport := p.transport
	p.transport = nil
	pc := p.pc
	p.mu.Unlock()
	if previous != nil {
		previous.close()
	}
	p.native.Store(client)
	if transport != nil {
		go func() { _ = pc.Close() }()
	}
	native.register(client)
	go track.expireLosses()

	for _, other := range sfu.Subscribers(track.key) {
		other.ensureSinks(track)
	}

	log.Printf("Client %s uses native UDP voice (SSRC: %d, mode: %s, payload types: audio %d, video %d, rtx %d)", p.id, msg.SSRC, msg.Mode, client.payloads.audio, client.payloads.video, client.payloads.rtx)
	if err := ipcConn.sendReply(requestID, SignalMessage{Type: "native", ClientID: p.id, SSRC: msg.SSRC}, ""); err != nil {
		return err
	}
	remote := "unknown"
	if addr := client.addr.Load(); addr != nil {
		remote = addr.String()
	}
	return ipcConn.sendReply("", SignalMessage{Type: "connected", ClientID: p.id, Remote: remote}, "")
}

func (pt *PublishedTrack) expireLosses() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-pt.stop:
			return
		case now := <-ticker.C:
			_, expired := pt.losses.due(now)
			pt.lost.Add(uint64(expired))
		}
	}
}

func (p *Peer) forward(pt *PublishedTrack, pkt *rtp.Packet) {
	if client := p.native.Load(); client != nil {
		client.send(pt, pkt)
		return
	}
	_ = p.master(pt.kind).WriteRTP(pkt, pt.extensions)
}

func (p *Peer) leaveNative() {
	client := p.native.Load()
	if client == nil {
		return
	}
	native.remove(client)
	if client.track != nil {
		client.track.close()
	}
	if video := client.video.Load(); video != nil {
		video.track.close()
	}
}

const sfuReportSSRC = 0x53465530

func (pt *PublishedTrack) receptionReport() (rtcp.ReceptionReport, bool) {
	base, highest, ok := pt.losses.extended()
	if !ok {
		return rtcp.ReceptionReport{}, false
	}
	expected := highest - base + 1
	received := uint32(pt.received.Load())
	lost := min(max(int64(expected)-int64(received), 0), 0x7fffff)
	expectedDelta := expected - pt.reportExpected
	receivedDelta := received - pt.reportReceived
	var fraction uint8
	if expectedDelta > receivedDelta {
		fraction = uint8(min(uint64(expectedDelta-receivedDelta)<<8/uint64(expectedDelta), 255))
	}
	pt.reportExpected, pt.reportReceived = expected, received
	return rtcp.ReceptionReport{SSRC: uint32(pt.ssrc), FractionLost: fraction, TotalLost: uint32(lost), LastSequenceNumber: highest}, true
}

func (p *Peer) reportReception() {
	client := p.native.Load()
	if client == nil {
		return
	}
	p.mu.Lock()
	tracks := []*PublishedTrack{p.audioPublished, p.videoPublished}
	p.mu.Unlock()
	var reports []rtcp.ReceptionReport
	for _, pt := range tracks {
		if pt == nil {
			continue
		}
		if report, ok := pt.receptionReport(); ok {
			reports = append(reports, report)
		}
	}
	if len(reports) > 0 {
		_ = client.sendRTCP([]rtcp.Packet{&rtcp.ReceiverReport{SSRC: sfuReportSSRC, Reports: reports}})
	}
}
