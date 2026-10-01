import type { Metadata, Viewport } from "next";
// Self-hosted Noto Sans Thai (Thai + Latin subsets) so Canvas, measurement and export use the same font.
import "@fontsource/noto-sans-thai/400.css";
import "@fontsource/noto-sans-thai/700.css";
// Monospace font of code blocks (same in the editor, the typing overlay and the export).
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/400-italic.css";
import "./globals.css";
import PwaRegistrar from "@/features/pwa/pwa-registrar";
import { THEME_SCRIPT } from "@/features/theme/theme-script";

export const metadata: Metadata = {
  title: "Learning Suit",
  description: "กระดานวาดสำหรับสอนสด จัดบทเรียนเป็นโปรเจกต์และสไลด์",
  applicationName: "Learning Suit",
  // Installed on iPad/iPhone from Safari's Share menu: open full screen with the app's own name.
  appleWebApp: { capable: true, title: "Learning Suit", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#FFFFFF" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The theme is set on <html> by a tiny script before paint (the server cannot know the device's choice).
  return <html lang="th" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
    <body>{children}<PwaRegistrar /></body>
  </html>;
}
