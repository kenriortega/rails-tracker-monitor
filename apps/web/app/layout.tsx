import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
export const metadata: Metadata = {title: "Rails — Centro de operaciones", description: "Una nueva perspectiva de la red ferroviaria. Prototipo de monitoreo con datos de demostración."};
export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="es"><body>{children}</body></html>;
}
