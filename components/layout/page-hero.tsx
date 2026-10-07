"use client";

import { motion } from "framer-motion";
import { Container } from "@/components/ui/container";
import { Heading } from "@/components/ui/heading";

/**
 * The navy hero that opens a sub-page (organism): the page's H1 and an
 * optional lead. The top padding reads --hero-top so it clears the fixed
 * navbar (and the announcement strip when it shows).
 */
export function PageHero({ title, lead }: { title: React.ReactNode; lead?: React.ReactNode }) {
  return (
    <section className="bg-gradient-to-br from-primary-blue to-accent-navy pt-[calc(var(--hero-top,8rem)_+_1.25rem)] pb-14 text-white md:pt-[calc(var(--hero-top,8rem)_+_2.5rem)] md:pb-24">
      <Container>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Heading level="page" className={lead ? "mb-4" : undefined}>
            {title}
          </Heading>
          {lead && <p className="max-w-[600px] text-base text-white/90 md:text-lg">{lead}</p>}
        </motion.div>
      </Container>
    </section>
  );
}
