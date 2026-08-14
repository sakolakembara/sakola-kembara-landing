"use client";

import Link from "next/link";
import Image from "next/image";
import { Mail, MapPin } from "lucide-react";
import SocialLinks from "@/components/SocialLinks";

export default function Footer() {
  return (
    <footer className="bg-gradient-to-b from-accent-navy to-primary-blue text-white">
      {/* Sunglow hairline — the brand accent, and it stops the footer from
          reading as a slab of dark. */}
      <div aria-hidden className="h-1 bg-secondary-yellow" />

      {/* Main Footer */}
      <div className="max-w-[1200px] mx-auto px-6 pt-12 md:pt-16 pb-8 md:pb-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10 md:gap-12">
          {/* Logo & Location */}
          <div>
            <Link href="/" aria-label="Sakola Kembara" className="inline-flex items-center mb-4">
              <Image
                src="/images/logo-sakola-kembara.png"
                alt="Sakola Kembara"
                width={300}
                height={103}
                className="h-10 w-auto [filter:invert(1)_hue-rotate(180deg)]"
              />
            </Link>
            <div className="flex items-start gap-3 text-sm text-white/75">
              <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
              Bandung, Jawa Barat, Indonesia
            </div>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-sm font-bold uppercase tracking-wider text-secondary-yellow mb-5">
              Kontak
            </h4>
            <ul className="space-y-4">
              <li>
                <a
                  href="mailto:contact@sakolakembara.org"
                  className="flex items-start gap-3 text-sm text-white/75 hover:text-white transition-colors"
                >
                  <Mail className="w-4 h-4 mt-0.5 shrink-0" />
                  contact@sakolakembara.org
                </a>
              </li>
            </ul>
          </div>

          {/* Social Media */}
          <div>
            <h4 className="text-sm font-bold uppercase tracking-wider text-secondary-yellow mb-5">
              Social Media
            </h4>
            <SocialLinks theme="dark" />
          </div>
        </div>
      </div>

      {/* Copyright */}
      <div className="border-t border-white/15">
        <div className="max-w-[1200px] mx-auto px-6 py-5 flex flex-col md:flex-row justify-between items-center gap-2">
          <p className="text-xs text-white/70">
            © {new Date().getFullYear()} Sakola Kembara. All rights reserved.
          </p>
          <p className="text-xs text-white/55">
            Yayasan Sakola Kembara Indonesia
          </p>
        </div>
      </div>
    </footer>
  );
}
