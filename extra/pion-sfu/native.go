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
	nativeNonceSuffix      = 4
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
	return packetType >= 200 && packetType <= 204
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

type nativeClient struct {
	peer    *Peer
	ssrc    uint32
	cipher  *nativeCipher
	track   *PublishedTrack
	addr    atomic.Pointer[net.UDPAddr]
	counter atomic.Uint32

	packets       atomic.Uint64
	rtcp          atomic.Uint64
	foreignSSRC   atomic.Uint64
	undecryptable atomic.Uint64
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

func (t *nativeTransport) remove(client *nativeClient) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.bySSRC[client.ssrc] == client {
		t.forgetLocked(client)
	}
}

func (t *nativeTransport) forgetLocked(client *nativeClient) {
	delete(t.bySSRC, client.ssrc)
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
	if client == nil && len(packet) >= 12 && packet[0]>>6 == 2 && !isRTCPPacketType(packet[1]) {
		client = t.bySSRC[binary.BigEndian.Uint32(packet[8:12])]
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
	if len(packet) < 12 || packet[0]>>6 != 2 {
		return
	}
	if isRTCPPacketType(packet[1]) {
		c.rtcp.Add(1)
		return
	}
	if binary.BigEndian.Uint32(packet[8:12]) != c.ssrc {
		c.foreignSSRC.Add(1)
		return
	}
	pkt, err := c.cipher.open(packet)
	if err != nil {
		c.undecryptable.Add(1)
		return
	}
	native.bind(c, from)
	if c.track != nil {
		c.track.ingest(pkt)
	}
}

func (c *nativeClient) send(pkt *rtp.Packet) {
	addr := c.addr.Load()
	if addr == nil {
		return
	}
	out, err := c.cipher.seal(pkt, nativeOpusPayloadType, c.counter.Add(1))
	if err != nil {
		return
	}
	native.write(out, addr)
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
	client := &nativeClient{peer: p, ssrc: msg.SSRC, cipher: nc}
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

	log.Printf("Client %s uses native UDP voice (SSRC: %d, mode: %s)", p.id, msg.SSRC, msg.Mode)
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
		if pt.kind == "audio" {
			client.send(pkt)
		}
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
}
