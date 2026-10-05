"use client";

import { useEffect, useState } from "react";

function still(html: string): string {
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

/**
 * Year art from public/years.
 * live: paid run, full clip.
 * still: free play, the frozen test version.
 */
export default function YearStage({
  year,
  live = false,
}: {
  year: number;
  live?: boolean;
}) {
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
        if (cancel || !text) return;
        setHtml(live ? text : still(text));
      })
      .catch(() => {
        if (!cancel) setHtml(null);
      });

    return () => {
      cancel = true;
    };
  }, [year, live]);

  if (!html) return null;

  return (
    <iframe
      title=""
      aria-hidden
      tabIndex={-1}
      sandbox={live ? "allow-scripts" : ""}
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
        transform: "translateZ(0)",
        contain: "strict",
      }}
    />
  );
}
