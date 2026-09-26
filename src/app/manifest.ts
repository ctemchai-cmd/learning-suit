import type { MetadataRoute } from "next";

// Web app manifest (served at /manifest.webmanifest): lets the teacher install Learning Suit as an app
// with its own window. Icons are built by scripts/build-pwa-icons.mjs from src/app/icon.svg.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Learning Suit",
    short_name: "Learning Suit",
    description: "กระดานวาดสำหรับสอนสด จัดบทเรียนเป็นโปรเจกต์และสไลด์",
    lang: "th",
    dir: "ltr",
    start_url: "/projects",
    scope: "/",
    display: "standalone",
    background_color: "#F8FAFC",
    theme_color: "#FFFFFF",
    categories: ["education", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
