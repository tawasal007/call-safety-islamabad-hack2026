import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Call Safety — private browser audio calls",
  description: "Two-person browser audio calls, built as the foundation for live, evidence-based safety warnings.",
  referrer: "no-referrer",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: 'try { document.documentElement.dataset.theme = localStorage.getItem("call-safety-theme") === "light" ? "light" : "dark"; } catch { document.documentElement.dataset.theme = "dark"; }' }} />
        {children}
      </body>
    </html>
  );
}
