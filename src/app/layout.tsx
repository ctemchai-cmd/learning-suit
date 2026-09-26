import type { Metadata, Viewport } from "next";
// Self-hosted Noto Sans Thai (Thai + Latin subsets) so Canvas, measurement and export use the same font.
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Learning Suit",
  description: "กระดานวาดสำหรับสอนสด จัดบทเรียนเป็นโปรเจกต์และสไลด์",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th"><body>{children}</body></html>;
}
