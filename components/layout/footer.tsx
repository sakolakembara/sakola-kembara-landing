"use client";

import Link from "next/link";
import Image from "next/image";
import { Mail, MapPin } from "lucide-react";
import { Container } from "@/components/ui/container";
import { SocialLinks } from "@/components/ui/social-links";
import { footerLinks } from "@/lib/data";
// Same mark as the navbar logo, with the black wordmark recoloured white so
// it reads on the navy footer.
import brandLogo from "@/public/images/logo-sakola-kembara-light.png";

/** Site footer (organism): brand, site links, contact and social links. */
export function Footer() {
  return (
    <footer className="bg-gradient-to-b from-accent-navy to-primary-blue text-white">
      {/* Sunglow hairline — the brand accent, and it stops the footer from
          reading as a slab of dark. */}
      <div aria-hidden className="h-1 bg-secondary-yellow" />

      {/* Main Footer */}
      <Container className="pt-12 md:pt-16 pb-8 md:pb-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))] gap-10 md:gap-12">
          {/* Logo, description & location */}
          <div>
            <Link href="/" aria-label="Sakola Kembara" className="inline-flex items-center mb-4">
              <Image
                src={brandLogo}
                alt="Sakola Kembara"
                width={300}
                height={103}
                className="h-10 w-auto"
              />
            </Link>
            <p className="text-sm text-white/75 leading-relaxed max-w-sm mb-4">
              Yayasan Sakola Kembara berkomitmen untuk memberikan kesempatan
              pendidikan yang setara kepada seluruh anak Indonesia.
            </p>
            <div className="flex items-start gap-3 text-sm text-white/75">
              <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
              Bandung, Jawa Barat, Indonesia
            </div>
          </div>

          {/* Site links */}
          <nav aria-labelledby="footer-links-heading">
            <h4
              id="footer-links-heading"
              className="text-sm font-bold uppercase tracking-wider text-secondary-yellow mb-5"
            >
              Jelajahi
            </h4>
            <ul className="space-y-3">
              {footerLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-white/75 hover:text-white transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

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
      </Container>

      {/* Copyright */}
      <div className="border-t border-white/15">
        <Container className="py-5">
          <p className="text-xs text-white/70 text-center">
            © {new Date().getFullYear()} Yayasan Sakola Kembara Indonesia. All
            rights reserved.
          </p>
        </Container>
      </div>
    </footer>
  );
}
