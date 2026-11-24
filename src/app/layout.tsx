import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import ToastViewport from "@/components/ToastViewport";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FINVANTA — Financial Intelligence & Management Ecosystem", template: "%s · FINVANTA" },
  description: "One platform. Every financial workflow. One intelligent AI assistant. Accounting, GST/TDS, analysis, markets, modelling, FP&A and AI.",
  authors: [{ name: "Vinod Kumar" }],
  creator: "Vinod Kumar",
  publisher: "FINVANTA",
};
export const viewport: Viewport = { themeColor: "#070d1a", width: "device-width", initialScale: 1 };

const themeInit = `try{var d=document.documentElement;var t=localStorage.getItem('fv-theme')||'dark';d.setAttribute('data-theme',t);var a=localStorage.getItem('fv-accent');if(a)d.style.setProperty('--accent',a);}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInit }} /></head>
      <body className="min-h-screen antialiased">{children}<ToastViewport /></body>
    </html>
  );
}
