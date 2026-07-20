import HeroSection from "@/components/sections/HeroSection";
import ProblemSection from "@/components/sections/ProblemSection";
import ActivitiesSection from "@/components/sections/ActivitiesSection";
import ImpactSection from "@/components/sections/ImpactSection";
import PartnersSection from "@/components/sections/PartnersSection";
import NewsSection from "@/components/sections/NewsSection";
import CTASection from "@/components/sections/CTASection";
import { getBlogArticlesSorted } from "@/lib/blog";
import { jsonLdScript, organizationJsonLd } from "@/lib/seo";

export default async function Home() {
  const latestArticles = (await getBlogArticlesSorted()).slice(0, 3);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(organizationJsonLd()) }}
      />
      <main>
        <HeroSection />
        <ProblemSection />
        <ActivitiesSection />
        <ImpactSection />
        <PartnersSection />
        <CTASection />
        <NewsSection articles={latestArticles} />
      </main>
    </>
  );
}
