import type { Metadata } from "next";
import { Lora, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL } from "@/lib/seo";

const lora = Lora({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const DEFAULT_TITLE = "Sakola Kembara - Pendidikan Untuk Semua";
const DEFAULT_DESCRIPTION =
  "Membuka pintu pendidikan tinggi untuk setiap anak Indonesia. Program bimbingan belajar gratis dan pendampingan intensif untuk siswa dari daerah terpencil dan keluarga kurang mampu.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: DEFAULT_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  keywords: [
    "Sakola Kembara",
    "Yayasan Sakola Kembara",
    "pendidikan",
    "beasiswa",
    "bimbel gratis",
    "UTBK",
    "PTN",
    "perguruan tinggi",
    "pemerataan pendidikan",
    "Indonesia",
    "nonprofit",
  ],
  authors: [{ name: "Yayasan Sakola Kembara Indonesia" }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: DEFAULT_TITLE,
    description:
      "Membuka pintu pendidikan tinggi untuk setiap anak Indonesia melalui program bimbingan belajar gratis.",
    url: "/",
    siteName: SITE_NAME,
    locale: "id_ID",
    type: "website",
    images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: "Membuka pintu pendidikan tinggi untuk setiap anak Indonesia.",
    images: [DEFAULT_OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className="scroll-smooth">
      <body
        className={`${lora.variable} ${plusJakartaSans.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
