/** Live Bloom lobby: start a private room with a friend, or join one. */
import { useEffect, useState } from "react";
import { IconLive } from "../components/Icons";
import { Avatar, Empty, Loading, SignInNeeded } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { webrtcSupported } from "../lib/liveSession";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import { useFriends } from "./Friends";

interface Room {
  id: string;
  status: string;
  is_host: boolean;
  friend: { bloom_id: string; display_name: string };
  online: string[];
}

export function LivePage() {
  const { user, toast } = useSession();
  const { navigate } = useRouter();
  const { data: friends } = useFriends();
  const [rooms, setRooms] = useState<Room[] | null>(null);

  const load = () =>
    api<Room[]>("/api/live/rooms")
      .then(setRooms)
      .catch((e) => {
        setRooms([]);
        toast(errorMessage(e), "error");
      });

  useEffect(() => {
    if (!user) return;
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user) {
    return (
      <main className="page">
        <SignInNeeded what="Live Bloom" />
      </main>
    );
  }

  const start = async (bloomId: string) => {
    try {
      const room = await api<Room>("/api/live/rooms", { body: { friend_bloom_id: bloomId } });
      navigate(`/live/${room.id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">05 · Live Bloom</p>
          <h1>
            Same moment, <span className="flourish">different places</span>
          </h1>
          <p className="lede" style={{ marginTop: 10 }}>
            Open a private room with a friend. You'll see and hear each other once you both switch your camera on, pick a
            flower and a look together, and take the photo at the same time.
          </p>
        </div>
      </div>
      {!webrtcSupported() && <p className="notice error">This browser doesn't support live video (WebRTC). Try a recent Chrome, Edge, Firefox or Safari.</p>}
      <div className="columns">
        <section className="panel">
          <h3>Open rooms</h3>
          {rooms === null ? (
            <Loading />
          ) : rooms.length === 0 ? (
            <p className="muted" style={{ marginTop: 10 }}>
              No rooms open. Start one with a friend.
            </p>
          ) : (
            rooms.map((room) => (
              <div key={room.id} className="person">
                <Avatar name={room.friend.display_name} />
                <div className="who">
                  <strong>{room.friend.display_name}</strong>
                  <span className="muted small">
                    {room.online.includes(room.friend.bloom_id) ? "is in the room now" : "not in the room right now"}
                  </span>
                </div>
                {room.online.includes(room.friend.bloom_id) && (
                  <span className="status-pill live">
                    <span className="dot" /> LIVE
                  </span>
                )}
                <Link to={`/live/${room.id}`} className="btn small primary">
                  Join
                </Link>
              </div>
            ))
          )}
        </section>
        <section className="panel">
          <h3>Start a room with</h3>
          {!friends ? (
            <Loading />
          ) : friends.friends.length === 0 ? (
            <Empty title="No friends yet" action={<Link to="/friends" className="btn">Add a friend</Link>}>
              Live rooms are private between two friends.
            </Empty>
          ) : (
            friends.friends.map((f) => (
              <div key={f.bloom_id} className="person">
                <Avatar name={f.display_name} />
                <div className="who">
                  <strong>{f.display_name}</strong>
                  <span className="bloom-id">{f.bloom_id}</span>
                </div>
                <button type="button" className="btn small" onClick={() => void start(f.bloom_id)} disabled={!webrtcSupported()}>
                  <IconLive /> Start
                </button>
              </div>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
