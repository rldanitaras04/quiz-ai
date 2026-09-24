import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
// Imported before globals.css so the design-token overrides there win over
// SweetAlert2's own defaults.
import "sweetalert2/dist/sweetalert2.min.css";
import "./globals.css";
import type { JSX, ReactNode } from 'react';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SEAMS AI — AI-Assisted Assessment",
  description: "AI-Assisted Secure Assessment System",
  icons: {
    icon: "/seams_ai_ico.png",
    shortcut: "/seams_ai_ico.png",
    apple: "/seams_ai_ico.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
