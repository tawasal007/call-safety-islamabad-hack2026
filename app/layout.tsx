import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "./components/app-shell";

export const metadata: Metadata = {
  title: "SadaSafe — private browser audio calls",
  description: "Two-person browser audio calls, built as the foundation for live, evidence-based safety warnings.",
  referrer: "no-referrer",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
