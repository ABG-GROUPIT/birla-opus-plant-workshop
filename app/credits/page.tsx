import Link from "next/link";

const credits = [
  {
    plant: "Panipat",
    region: "Haryana",
    creator: "puneet kumar",
    href: "https://unsplash.com/photos/QVGflrSGD9o",
  },
  {
    plant: "Ludhiana",
    region: "Punjab",
    creator: "Abhinav Sharma",
    href: "https://unsplash.com/photos/YtEb5M_1nOc",
  },
  {
    plant: "Cheyyar",
    region: "Tamil Nadu",
    creator: "cymatics .in",
    href: "https://unsplash.com/photos/U-5qN1L0qHk",
  },
  {
    plant: "Chamarajanagar",
    region: "Karnataka",
    creator: "Amit K",
    href: "https://unsplash.com/photos/z6f8YJv1VTQ",
  },
  {
    plant: "Mahad",
    region: "Maharashtra",
    creator: "Zoshua Colah",
    href: "https://unsplash.com/photos/5nZQuot4HFA",
  },
  {
    plant: "Kharagpur",
    region: "West Bengal",
    creator: "Jayanta Kr Golder",
    href: "https://unsplash.com/photos/8g2XxmjPpvs",
  },
  {
    plant: "Head Office (Mumbai)",
    region: "Mumbai, Maharashtra",
    creator: "Drone Master",
    href: "https://unsplash.com/photos/qrj4LiT9NRQ",
  },
];

export default function CreditsPage() {
  return (
    <main className="credits-page">
      <Link className="credits-back" href="/">← Back to Workshop Canvas</Link>
      <p className="eyebrow">Image attribution</p>
      <h1>Photo credits</h1>
      <p className="credits-intro">
        Regional landscape photography is sourced from Unsplash and displayed
        with responsive cropping under the Unsplash License.
      </p>
      <div className="credits-list">
        {credits.map((credit, index) => (
          <a href={credit.href} key={credit.plant} target="_blank" rel="noreferrer">
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{credit.plant}</strong>
            <small>{credit.region} · {credit.creator}</small>
            <b>Unsplash License ↗</b>
          </a>
        ))}
      </div>
    </main>
  );
}
