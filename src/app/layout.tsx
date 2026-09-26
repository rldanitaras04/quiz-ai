import type { Metadata, Viewport } from "next";
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
  description: "AI-Assisted Secure Examination and Assessment System",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SEAMS AI",
  },
  icons: {
    icon: "/icons/icon-192.png",
    shortcut: "/seams_ai_ico.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Apply the stored (or system) theme before first paint to avoid a flash.
            `data-theme` records the raw preference so an explicit Light choice is
            never overridden by a dark OS setting. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('mimo:theme');if(t!=='light'&&t!=='dark'){t='system';}var dark=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',dark);document.documentElement.dataset.theme=t;}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
