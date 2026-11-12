import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LaunchLoop — Product-Launch Campaign Autopilot for Buffer",
  description:
    "Enter a launch date and product details. LaunchLoop generates a 14-day multi-channel posting calendar and schedules the whole campaign through the Buffer API.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
