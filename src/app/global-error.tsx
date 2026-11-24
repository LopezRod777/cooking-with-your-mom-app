"use client";

// Last line of defense: an error in the root layout. It replaces the layout, so it brings its own html and body.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#fbf7f0", color: "#2a1f17", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "48px 16px", display: "grid", gap: 20 }}>
          <h1 style={{ fontSize: 30, margin: 0 }}>Mama dropped a spoon.</h1>
          <p style={{ fontSize: 18, margin: 0 }}>Something broke. Your recipes and plan are safe.</p>
          <button
            onClick={() => retry()}
            style={{ height: 60, borderRadius: 999, border: 0, background: "#c93a24", color: "#fff", fontSize: 20, fontWeight: 600 }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
