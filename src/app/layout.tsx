import type { Metadata, Viewport } from "next";
// Self-hosted Noto Sans Thai (Thai + Latin subsets) so Canvas, measurement and export use the same font.
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/700.css";
import "./globals.css";
import PwaRegistrar from "@/features/pwa/pwa-registrar";

export const metadata: Metadata = {
  title: "Learning Suit",
  description: "กระดานวาดสำหรับสอนสด จัดบทเรียนเป็นโปรเจกต์และสไลด์",
  applicationName: "Learning Suit",
  // Installed on iPad/iPhone from Safari's Share menu: open full screen with the app's own name.
  appleWebApp: { capable: true, title: "Learning Suit", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#FFFFFF" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th"><body>{children}<PwaRegistrar /></body></html>;
}
