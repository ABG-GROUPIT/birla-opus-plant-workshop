import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const configuredSiteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  "https://abg-groupit.github.io/birla-opus-plant-workshop/";
const siteUrl = new URL(
  configuredSiteUrl.endsWith("/") ? configuredSiteUrl : `${configuredSiteUrl}/`,
);
const imageUrl = new URL("og.png", siteUrl).toString();
const markUrl = new URL("brand/birla-opus-mark.png", siteUrl).toString();
const title = "Birla Opus Plant Workshop Canvas";
const description =
  "Collect, verify and present workshop responses from six Birla Opus plants.";

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title,
  description,
  icons: {
    icon: markUrl,
    apple: markUrl,
  },
  openGraph: {
    url: siteUrl,
    title,
    description,
    type: "website",
    images: [
      {
        url: imageUrl,
        width: 1729,
        height: 908,
        alt: "Birla Opus Plant Workshop Canvas — Six plants. One shared view.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [imageUrl],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
