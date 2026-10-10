import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Guardian Link — Family calls & live captions",
  description: "Two-person audio calls with live English and Urdu captions, translation, keyword evidence and separate saved logs.",
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
