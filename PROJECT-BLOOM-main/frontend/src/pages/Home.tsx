import { FlowerPreview } from "../components/FlowerPreview";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";

const FEATURES = [
  { to: "/studio", num: "01", title: "Studio", text: "Grow custom petal shapes, spiral blooms, inscriptions and themes from any word." },
  { to: "/cam", num: "02", title: "Bloom Cam", text: "Multi-flower overlays, hand-tracking, photo crop, Polaroids, strips and contact sheets." },
  { to: "/journal", num: "03", title: "Journal & Scrapbook", text: "Compose digital scrapbook pages with stickers, tape, doodles, drawings and collections." },
  { to: "/together", num: "04", title: "Bloom Together", text: "Collaborate live on Twin Bloom, Two Blooms or Our Moment with built-in session chat." },
  { to: "/live", num: "05", title: "Live Bloom", text: "See each other on camera, pick a flower together and capture the shot at once." },
  { to: "/chat", num: "06", title: "Bloom Chat", text: "Private DMs, voice notes, group chats and Studio Chat rooms with friends." },
  { to: "/activity", num: "07", title: "Friends & Feed", text: "Share flowers and journal pages on your profile, follow friends and react together." },
];

export function HomePage() {
  const { recipe, user, ready, serverOnline, deviceMode, useThisDevice, hasFlower } = useSession();
  const { navigate } = useRouter();
  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">A creative &amp; social journal of flowers grown from words</p>
          <h1>
            Say it with <span className="flourish">a flower</span> made of your own words.
          </h1>
          <p className="lede">
            Bloom writes your word along every petal of a hand-coded flower, lets you photograph and scrapbook it,
            and share creations privately or live with the people you care about.
          </p>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={() => navigate("/studio")}>
              Grow a flower
            </button>
            <Link to="/scrapbook" className="btn">
              Open Scrapbook
            </Link>
            {ready && !user && serverOnline && !deviceMode && (
              <>
                <Link to="/signup" className="btn">
                  Create an account
                </Link>
                <button type="button" className="btn quiet" onClick={useThisDevice}>
                  Just use this device
                </button>
              </>
            )}
            {user && (
              <Link to="/journal" className="btn">
                Open {user.display_name}'s journal
              </Link>
            )}
          </div>
        </div>
        <div className="plate">
          <FlowerPreview recipe={recipe} />
          <div className="plate-caption">
            <span>{hasFlower ? `Plate I · “${recipe.word}”` : "A sample flower"}</span>
            <span className="lcd">{hasFlower ? "your last bloom" : "grow your own in the studio"}</span>
          </div>
        </div>
      </section>
      <section className="feature-row" aria-label="What you can do">
        {FEATURES.map((f) => (
          <Link key={f.to} to={f.to} className="feature">
            <span className="num">{f.num}</span>
            <h3>{f.title}</h3>
            <span>{f.text}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
