package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

func TestGatheringCompletionAndCancellation(t *testing.T) {
	complete := make(chan struct{})
	close(complete)
	if err := waitForGathering(context.Background(), complete); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := waitForGathering(ctx, make(chan struct{})); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation: %v", err)
	}
	ctx, cancel = context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	if err := waitForGathering(ctx, make(chan struct{})); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline: %v", err)
	}
}

func TestStopPublishConcurrentWithForwarding(t *testing.T) {
	p := &Peer{audioPublished: &PublishedTrack{}, isAudioPublished: true}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			if err := handleStopPublish(p, SignalMessage{TrackType: "audio"}); err != nil {
				t.Error(err)
			}
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			p.isPublishing("audio")
		}
	}()
	wg.Wait()
	if p.isPublishing("audio") {
		t.Fatal("publication remained active")
	}
}

func TestSubscribersDoNotWaitForPeerLocks(t *testing.T) {
	r := NewSfu()
	p := &Peer{id: "subscriber"}
	publisher := &Peer{id: "publisher"}
	r.AddPeer(p)
	r.AddPeer(publisher)
	if err := r.Subscribe(p, publisher, "audio"); err != nil {
		t.Fatal(err)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	finished := make(chan []*Peer, 1)
	go func() { finished <- r.Subscribers("publisher_audio") }()
	select {
	case targets := <-finished:
		if len(targets) != 1 || targets[0] != p {
			t.Fatalf("unexpected subscribers: %v", targets)
		}
	case <-time.After(time.Second):
		t.Fatal("subscriber lookup waited for subscriber state")
	}
	removed := make(chan struct{})
	go func() { r.RemovePeer(p.id); close(removed) }()
	select {
	case <-removed:
	case <-time.After(time.Second):
		t.Fatal("registry write blocked on subscriber state")
	}
	if targets := r.Subscribers("publisher_audio"); len(targets) != 0 {
		t.Fatalf("removed peer still subscribed: %v", targets)
	}
}

func writeIPC(t *testing.T, conn net.Conn, msg IpcMessage) {
	t.Helper()
	data, err := json.Marshal(msg)
	if err != nil {
		t.Fatal(err)
	}
	frame := make([]byte, 4+len(data))
	binary.BigEndian.PutUint32(frame, uint32(len(data)))
	copy(frame[4:], data)
	if _, err = conn.Write(frame); err != nil {
		t.Fatal(err)
	}
}
func readIPC(t *testing.T, conn net.Conn) IpcMessage {
	t.Helper()
	conn.SetReadDeadline(time.Now().Add(time.Second))
	var header [4]byte
	if _, err := io.ReadFull(conn, header[:]); err != nil {
		t.Fatal(err)
	}
	data := make([]byte, binary.BigEndian.Uint32(header[:]))
	if _, err := io.ReadFull(conn, data); err != nil {
		t.Fatal(err)
	}
	var msg IpcMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatal(err)
	}
	return msg
}
func TestIPCHeartbeatBypassesBusyClientAndPreservesOrder(t *testing.T) {
	oldSFU := sfu
	sfu = NewSfu()
	defer func() { sfu = oldSFU }()
	server, client := net.Pipe()
	defer client.Close()
	connection := &IpcConnection{conn: server}
	p := &Peer{id: "busy-client", audioPublished: &PublishedTrack{}}
	sfu.AddPeer(p)
	p.mu.Lock()
	locked := true
	defer func() {
		if locked {
			p.mu.Unlock()
		}
	}()
	done := make(chan struct{})
	go func() { connection.handleConnection(); close(done) }()
	writeIPC(t, client, IpcMessage{ID: "stop", Payload: SignalMessage{ClientID: p.id, Type: "stop-publish", TrackType: "audio"}})
	writeIPC(t, client, IpcMessage{ID: "after", Payload: SignalMessage{ClientID: p.id, Type: "unknown"}})
	writeIPC(t, client, IpcMessage{ID: "heartbeat", Type: "ping"})
	if msg := readIPC(t, client); msg.ID != "heartbeat" || msg.Payload.Type != "pong" {
		t.Fatalf("heartbeat did not bypass blocked client: %+v", msg)
	}
	p.mu.Unlock()
	locked = false
	if msg := readIPC(t, client); msg.ID != "after" || msg.Error == "" {
		t.Fatalf("unexpected ordered reply: %+v", msg)
	}
	client.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("IPC workers did not stop on disconnect")
	}
}
func TestIPCWriteFailureIsReturned(t *testing.T) {
	server, client := net.Pipe()
	client.Close()
	defer server.Close()
	connection := &IpcConnection{conn: server}
	if err := connection.sendReply("test", SignalMessage{Type: "pong"}, ""); err == nil {
		t.Fatal("closed stream reported successful reply")
	}
}
func BenchmarkSubscriberSnapshot(b *testing.B) {
	for _, size := range []int{10, 100, 1000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			r := NewSfu()
			publisher := &Peer{id: "publisher"}
			r.AddPeer(publisher)
			for i := 0; i < size; i++ {
				p := &Peer{id: fmt.Sprint(i)}
				r.AddPeer(p)
				if i < 5 {
					if err := r.Subscribe(p, publisher, "audio"); err != nil {
						b.Fatal(err)
					}
				}
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				r.Subscribers("publisher_audio")
			}
		})
	}
}

func TestOfferReturnsGatheredCompatibleAnswer(t *testing.T) {
	engine, err := createMediaEngine()
	if err != nil {
		t.Fatal(err)
	}
	api := webrtc.NewAPI(webrtc.WithMediaEngine(engine))
	clientPC, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer clientPC.Close()
	if _, err := clientPC.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio); err != nil {
		t.Fatal(err)
	}
	offer, err := clientPC.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := clientPC.SetLocalDescription(offer); err != nil {
		t.Fatal(err)
	}
	serverPC, err := api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer serverPC.Close()
	server, client := net.Pipe()
	defer client.Close()
	defer server.Close()
	previousIPC := ipcConn
	ipcConn = &IpcConnection{conn: server}
	defer func() { ipcConn = previousIPC }()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- handleOffer(ctx, &Peer{id: "offer-client", pc: serverPC}, SignalMessage{SDP: offer.SDP}, "offer")
	}()
	reply := readIPC(t, client)
	if reply.ID != "offer" || reply.Payload.Type != "answer" || reply.Payload.SDP == "" {
		t.Fatalf("invalid answer: %+v", reply)
	}
	if err := clientPC.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: reply.Payload.SDP}); err != nil {
		t.Fatalf("answer rejected: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if serverPC.ICEGatheringState() != webrtc.ICEGatheringStateComplete {
		t.Fatal("answer returned before gathering completed")
	}
}
