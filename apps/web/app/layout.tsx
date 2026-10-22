import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
export const metadata: Metadata = {title: "Rails — Centro de operaciones", description: "Una nueva perspectiva de la red ferroviaria. Prototipo de monitoreo con datos de demostración."};
export default function RootLayout({children}: {children: React.ReactNode}) {
  // Las extensiones del navegador escriben atributos en el <body> antes de que
  // React hidrate: Grammarly, por ejemplo, anade data-gr-ext-installed. El
  // suppressHydrationWarning silencia esa comparacion solo en este elemento y
  // un nivel de profundidad, no en los componentes de dentro. A cambio, un
  // desajuste real en los atributos del body dejaria de avisarse.
  return <html lang="es"><body suppressHydrationWarning>{children}</body></html>;
}
