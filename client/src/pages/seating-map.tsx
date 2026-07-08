// Office seating map — served same-origin (client/public/seating-chart.html)
// and embedded here so it lives inside the C3 shell like any other tab. The
// map state (names + role colors) is shared: it persists to C3's database via
// /api/seating-chart/state, so an edit on any device shows up for everyone.
export default function SeatingMap() {
  return (
    <div className="p-4 sm:p-6 h-[calc(100vh-6rem)]">
      <iframe
        src="/seating-chart.html"
        title="Office Seating Map"
        className="w-full h-full rounded-2xl border bg-card"
        data-testid="seating-map-frame"
      />
    </div>
  );
}
