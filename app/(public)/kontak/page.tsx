"use client";

import { motion } from "framer-motion";
import { Mail, MessageCircle, MapPin } from "lucide-react";
import { PageHero } from "@/components/layout/page-hero";
import { Container } from "@/components/ui/container";
import { Heading } from "@/components/ui/heading";
import { contactInfo } from "@/lib/data";
import SocialLinks from "@/components/SocialLinks";
import { ContactForm } from "./_contact-form";

const contactIcons = [
  { Icon: Mail, iconBg: "bg-gray-200", iconColor: "text-gray-600" },
  { Icon: MessageCircle, iconBg: "bg-gray-200", iconColor: "text-gray-600" },
  { Icon: MapPin, iconBg: "bg-gray-200", iconColor: "text-gray-600" },
];

export default function KontakPage() {
  return (
    <>
      <main className="min-h-screen bg-white">
        <PageHero
          title="Mari Bergerak Bersama"
          lead="Punya pertanyaan, ingin berkolaborasi, atau tertarik menjadi relawan? Kami senang mendengar dari Anda."
        />

        {/* Main Content */}
        <section className="py-16">
          <Container>
            <div className="grid lg:grid-cols-2 gap-16">
              {/* Contact Form */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <Heading level="panel" as="h2" className="text-gray-900 mb-6">
                  Kirim Pesan
                </Heading>

                <ContactForm />
              </motion.div>

              {/* Contact Info */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
              >
                <Heading level="panel" as="h2" className="text-gray-900 mb-6">
                  Informasi Kontak
                </Heading>

                {/* Contact Methods */}
                <div className="space-y-5 mb-10">
                  {contactInfo.map((contact, index) => {
                    const { Icon, iconBg, iconColor } = contactIcons[index];
                    return (
                      <div key={contact.title} className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                        <div className={`w-12 h-12 ${iconBg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                          <Icon className={`w-6 h-6 ${iconColor}`} />
                        </div>
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900">
                            {contact.title}
                          </h4>
                          <p className="text-gray-600">{contact.value}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Social Links */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Ikuti Kami
                  </h3>
                  <SocialLinks theme="light" />
                </div>
              </motion.div>
            </div>
          </Container>
        </section>
      </main>
    </>
  );
}
