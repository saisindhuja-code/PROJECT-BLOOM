import { FlowerPreview } from "../components/FlowerPreview";
import { Link, useRouter } from "../lib/router";
import { useSession } from "../lib/session";

const FEATURES = [
  { to: "/studio", num: "01", title: "Studio", text: "Type a word and it grows into petals, exactly like the original Bloom program." },
  { to: "/cam", num: "02", title: "Bloom Cam", text: "Hold your flower up to the camera, then give it a film, Polaroid or Y2K look." },
  { to: "/journal", num: "03", title: "Journal", text: "Every flower and photo, with captions, notes, dates and albums." },
  { to: "/together", num: "04", title: "Together", text: "Make one picture with a friend far away, each in your own time." },
  { to: "/live", num: "05", title: "Live Bloom", text: "See each other on camera, pick a flower together and take the shot at once." },
];

export function HomePage() {
  const { recipe, user, ready, serverOnline, deviceMode, useThisDevice, hasFlower } = useSession();
  const { navigate } = useRouter();
  return (
    <main className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">A journal of flowers grown from words</p>
          <h1>
            Say it with <span className="flourish">a flower</span> made of your own words.
          </h1>
          <p className="lede">
            Bloom writes your word along every petal of a hand-coded flower, then lets you photograph it, give it the
            look of an old camera, and keep it in a journal you can share with the people you love.
          </p>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={() => navigate("/studio")}>
              Grow a flower
            </button>
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
