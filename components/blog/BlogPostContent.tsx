"use client";

import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface BlogPostContentProps {
  /** Primary: markdown source (editable in content/blog/*.md) */
  markdown?: string;
  /** Fallback: pre-rendered HTML from sync/scrape */
  html?: string;
}

function isLocalImage(src: string) {
  return src.startsWith("/blog/images/");
}

const markdownComponents: Components = {
  img: ({ src, alt }) => {
    const imageSrc = typeof src === "string" ? src : undefined;
    if (!imageSrc) return null;
    if (isLocalImage(imageSrc)) {
      return (
        <span className="block my-6 relative w-full max-w-full">
          <Image
            src={imageSrc}
            alt={alt || ""}
            width={1024}
            height={768}
            className="rounded-xl w-full h-auto"
            unoptimized
            sizes="(max-width: 800px) 100vw, 800px"
          />
        </span>
      );
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageSrc} alt={alt || ""} className="rounded-xl max-w-full h-auto my-6" loading="lazy" />
    );
  },
  a: ({ href, children }) => (
    <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export default function BlogPostContent({ markdown, html }: BlogPostContentProps) {
  if (markdown?.trim()) {
    return (
      <div className="blog-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {markdown}
        </ReactMarkdown>
      </div>
    );
  }

  if (html?.trim()) {
    return (
      <div className="blog-content" dangerouslySetInnerHTML={{ __html: html }} />
    );
  }

  return null;
}
