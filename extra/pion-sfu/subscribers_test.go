package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/pion/webrtc/v4"
)

func benchSubscribe(r *Sfu, sub, publisher *Peer, trackType string) {
	if err := r.Subscribe(sub, publisher, trackType); err != nil {
		panic(err)
	}
}

func benchRooms(rooms, size int) (*Sfu, []string) {
	r := NewSfu()
	var keys []string
	for room := 0; room < rooms; room++ {
		peers := make([]*Peer, size)
		for i := range peers {
			peers[i] = &Peer{id: fmt.Sprint("room", room, "peer", i)}
			keys = append(keys, peers[i].id+"_audio")
			r.AddPeer(peers[i])
		}
		for _, sub := range peers {
			for _, publisher := range peers {
				if publisher != sub {
					benchSubscribe(r, sub, publisher, "audio")
				}
			}
		}
	}
	return r, keys
}

func BenchmarkRoomForwarding(b *testing.B) {
	for _, shape := range []struct{ rooms, size int }{{1, 10}, {1, 25}, {1, 100}, {40, 25}} {
		size := shape.size
		b.Run(fmt.Sprintf("%dx%d", shape.rooms, size), func(b *testing.B) {
			r, keys := benchRooms(shape.rooms, size)
			var next atomic.Uint64
			b.ReportAllocs()
			b.ResetTimer()
			b.RunParallel(func(pb *testing.PB) {
				for pb.Next() {
					key := keys[next.Add(1)%uint64(len(keys))]
					if len(r.Subscribers(key)) != size-1 {
						b.Fatal("missing subscribers")
					}
				}
			})
		})
	}
}

func benchLossTick(r *Sfu, tracks []*PublishedTrack) {
	for _, pt := range tracks {
		worstSubscriberLoss(pt, r.Subscribers(pt.key))
	}
}

func BenchmarkBandwidthTick(b *testing.B) {
	for _, shape := range []struct{ rooms, size, video int }{{1, 25, 5}, {40, 25, 5}} {
		b.Run(fmt.Sprintf("%dx%d", shape.rooms, shape.size), func(b *testing.B) {
			r := NewSfu()
			var tracks []*PublishedTrack
			for room := 0; room < shape.rooms; room++ {
				peers := make([]*Peer, shape.size)
				for i := range peers {
					peers[i] = &Peer{id: fmt.Sprint("room", room, "peer", i), videoLoss: map[uint32]lossReport{}}
					r.AddPeer(peers[i])
				}
				for i := 0; i < shape.video; i++ {
					pt := &PublishedTrack{ssrc: webrtc.SSRC(room*1000 + i), kind: "video", key: subscriptionKey(peers[i].id, "video"), publisher: peers[i]}
					tracks = append(tracks, pt)
					for _, sub := range peers {
						if sub != peers[i] {
							benchSubscribe(r, sub, peers[i], "video")
						}
					}
				}
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				benchLossTick(r, tracks)
			}
		})
	}
}

func TestSubscriberIndexFollowsSubscriptions(t *testing.T) {
	r := NewSfu()
	alice, bob, carol := &Peer{id: "alice"}, &Peer{id: "bob"}, &Peer{id: "carol"}
	for _, p := range []*Peer{alice, bob, carol} {
		r.AddPeer(p)
	}
	for _, sub := range []*Peer{bob, carol} {
		if err := r.Subscribe(sub, alice, "audio"); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Subscribe(bob, alice, "audio"); err == nil {
		t.Fatal("a second subscription to the same track was accepted")
	}
	if err := r.Subscribe(alice, bob, "video"); err != nil {
		t.Fatal(err)
	}
	before := r.Subscribers("alice_audio")
	if len(before) != 2 || before[0] != bob || before[1] != carol {
		t.Fatalf("unexpected subscribers: %v", before)
	}
	if err := r.Unsubscribe(bob, "alice_audio"); err != nil {
		t.Fatal(err)
	}
	if err := r.Unsubscribe(bob, "alice_audio"); err == nil {
		t.Fatal("unsubscribing twice was accepted")
	}
	if len(before) != 2 || before[0] != bob || before[1] != carol {
		t.Fatalf("an earlier lookup changed under its reader: %v", before)
	}
	if after := r.Subscribers("alice_audio"); len(after) != 1 || after[0] != carol {
		t.Fatalf("unexpected subscribers after unsubscribe: %v", after)
	}
	if r.IsSubscribed(bob, "alice_audio") || !r.IsSubscribed(carol, "alice_audio") || !r.IsSubscribed(alice, "bob_video") {
		t.Fatal("subscription state disagrees with the index")
	}
	r.RemovePeer("alice")
	if len(r.Subscribers("alice_audio")) != 0 || len(r.Subscribers("bob_video")) != 0 {
		t.Fatal("a removed peer is still indexed")
	}
	if r.IsSubscribed(carol, "alice_audio") {
		t.Fatal("a subscription to a removed publisher survived")
	}
	if err := r.Subscribe(carol, alice, "audio"); err == nil {
		t.Fatal("subscribed to a publisher that left")
	}
	if err := r.Subscribe(alice, bob, "audio"); err == nil {
		t.Fatal("a peer that left subscribed")
	}
	if len(r.subscribers) != 0 || len(r.subscriptions[bob]) != 0 || len(r.subscriptions[carol]) != 0 {
		t.Fatalf("index kept stale entries: %v %v", r.subscribers, r.subscriptions)
	}
}

func TestSubscriberIndexUnderConcurrentChurn(t *testing.T) {
	r := NewSfu()
	publisher := &Peer{id: "publisher"}
	r.AddPeer(publisher)
	subs := make([]*Peer, 16)
	for i := range subs {
		subs[i] = &Peer{id: fmt.Sprint("sub", i)}
		r.AddPeer(subs[i])
	}
	stop := make(chan struct{})
	var readers sync.WaitGroup
	for i := 0; i < 4; i++ {
		readers.Add(1)
		go func() {
			defer readers.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				seen := map[*Peer]bool{}
				for _, p := range r.Subscribers("publisher_audio") {
					if seen[p] {
						t.Error("a subscriber appears twice")
						return
					}
					seen[p] = true
				}
			}
		}()
	}
	var writers sync.WaitGroup
	for _, sub := range subs {
		writers.Add(1)
		go func(sub *Peer) {
			defer writers.Done()
			for i := 0; i < 500; i++ {
				_ = r.Subscribe(sub, publisher, "audio")
				_ = r.Unsubscribe(sub, "publisher_audio")
			}
			_ = r.Subscribe(sub, publisher, "audio")
		}(sub)
	}
	writers.Wait()
	close(stop)
	readers.Wait()
	if got := len(r.Subscribers("publisher_audio")); got != len(subs) {
		t.Fatalf("expected %d subscribers, got %d", len(subs), got)
	}
	r.RemovePeer(subs[3].id)
	if got := len(r.Subscribers("publisher_audio")); got != len(subs)-1 {
		t.Fatalf("expected %d subscribers after a leave, got %d", len(subs)-1, got)
	}
}
