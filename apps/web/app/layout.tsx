import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Skrivebord", description: "Fælles arbejdsflade for mennesker og AI-medarbejdere" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="da"><body>{children}</body></html>;
}
