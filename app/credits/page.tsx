const credits = [
  {
    plant: "Panipat",
    creator: "L&T Panipat Elevated Corridor Limited",
    licence: "CC BY-SA 4.0",
    href: "https://commons.wikimedia.org/wiki/File:Panipat-elevated-corridor.jpg",
  },
  {
    plant: "Ludhiana",
    creator: "Benison P Baby",
    licence: "CC BY-SA 4.0",
    href: "https://commons.wikimedia.org/wiki/File:Ludhiana_skyline.jpg",
  },
  {
    plant: "Cheyyar",
    creator: "Meter mexico",
    licence: "CC BY-SA 4.0",
    href: "https://commons.wikimedia.org/wiki/File:Vedhapureshwar_temple_at_bank_of_cheyyar_river.jpg",
  },
  {
    plant: "Chamarajanagar",
    creator: "Kalyan Varma",
    licence: "CC BY-SA 4.0",
    href: "https://commons.wikimedia.org/wiki/File:BR_Hills_Landscape_DSC_5585.jpg",
  },
  {
    plant: "Mahad",
    creator: "Sanketr3392",
    licence: "CC BY-SA 4.0",
    href: "https://commons.wikimedia.org/wiki/File:Waterfalls_of_Shivathar_ghalai%2C_Mahad-Raigad.jpg",
  },
  {
    plant: "Kharagpur",
    creator: "Ambuj Saxena",
    licence: "CC BY 2.5",
    href: "https://commons.wikimedia.org/wiki/File:IIT_Kharagpur_Main_Building.JPG",
  },
];

export default function CreditsPage() {
  return (
    <main className="credits-page">
      <a className="credits-back" href="/">← Back to Workshop Canvas</a>
      <p className="eyebrow">Image attribution</p>
      <h1>Photo credits</h1>
      <p className="credits-intro">
        Location photography is sourced from Wikimedia Commons and displayed
        with light cropping for the plant-selection experience.
      </p>
      <div className="credits-list">
        {credits.map((credit, index) => (
          <a href={credit.href} key={credit.plant} target="_blank" rel="noreferrer">
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{credit.plant}</strong>
            <small>{credit.creator}</small>
            <b>{credit.licence} ↗</b>
          </a>
        ))}
      </div>
    </main>
  );
}
