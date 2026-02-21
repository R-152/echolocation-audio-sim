import SonicWorld from "../components/SonicWorld";

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="intro-card">
        <p className="intro-tag">Next.js + TypeScript</p>
        <h1>3D Echolocation World</h1>
        <p>
          Explore a realistic digital world with 3D earbud audio, moving emitters, walk mode, and
          editable collision obstacles.
        </p>
      </section>
      <SonicWorld />
    </main>
  );
}
