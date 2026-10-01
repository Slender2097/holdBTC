"use client";

import { useEffect, useState } from "react";

function lighten(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/class="([^"]*)\bcrayon\b([^"]*)"/g, 'class="$1$2"')
    .replace(/filter:\s*url\(#crayon-filter\)/g, "filter:none")
    .replace(/<filter id="crayon-filter">[\s\S]*?<\/filter>/g, "")
    .replace(
      "</head>",
      "<style>*{animation:none!important;transition:none!important}.crayon,svg.crayon{filter:none!important}</style></head>"
    );
}

/** Static year art. Motion and scripts are removed so the game does not lag. */
export default function YearStage({ year }: { year: number }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    if (year < 2008 || year > 2026) {
      setHtml(null);
      return;
    }

    let cancel = false;
    fetch(`/years/${year}.html`)
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => {
        if (!cancel && text) setHtml(lighten(text));
      })
      .catch(() => {
        if (!cancel) setHtml(null);
      });

    return () => {
      cancel = true;
    };
  }, [year]);

  if (!html) return null;

  return (
    <iframe
      title=""
      aria-hidden
      tabIndex={-1}
      sandbox=""
      srcDoc={html}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        border: 0,
        pointerEvents: "none",
        zIndex: 0,
        background: "transparent",
      }}
    />
  );
}
