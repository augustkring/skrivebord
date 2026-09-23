import type { Metadata } from "next";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import "./globals.css";

export const metadata: Metadata = { title: "Skrivebord", description: "Fælles arbejdsflade for mennesker og AI-medarbejdere" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="da"><body>{children}</body></html>;
}
