// Office seating map — the standalone seating-chart app served as a same-origin
// static asset (client/public/seating-chart.html) and embedded here so it lives
// inside the C3 shell like any other tab. Seat edits persist in the browser's
// localStorage (per-device), exactly like the standalone app did.
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
