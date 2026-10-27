import type { MetadataRoute } from "next";

/**
 * Web app manifest (UX-03): makes the dashboard installable, nothing more.
 *
 * There is deliberately no service worker, so no offline cache: pages, RSC payloads and
 * API responses carry personal financial data and must never be stored by the browser
 * for offline use. Installation only needs this manifest and the icons.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tableau de bord",
    short_name: "Tableau de bord",
    description: "Tableau de bord personnel : budget, immobilier et projets GitHub / GitLab.",
    lang: "fr",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
