"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { TrendingPost } from "@/lib/trending/apify";
import { compactCount } from "@/lib/trending/format";
import { titleFrom } from "@/lib/trending/rank";

const FeedResponse = z.object({ posts: z.array(TrendingPost) });
const STRIP_SIZE = 6;

// Week-page strip: the first posts of /api/trending. Renders nothing while loading or when there are no posts.
// Phone: snap scroll strip, cards at 78vw. Desktop: 3 columns. Bottom padding keeps the last card clear of the sticky bar.
export function TrendingStrip() {
  const [posts, setPosts] = useState<TrendingPost[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/trending", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const parsed = FeedResponse.safeParse(data);
        if (!cancelled && parsed.success) setPosts(parsed.data.posts.slice(0, STRIP_SIZE));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (posts.length === 0) return null;

  return (
    <section
      aria-labelledby="trending-strip-title"
      className="grid gap-4 pb-[134px] lg:col-span-full lg:pb-0"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="trending-strip-title" className="font-display text-[24px] leading-tight">
          Trending now
        </h2>
        <Link href="/trending" className="flex min-h-12 items-center px-2 text-[17px] font-semibold underline underline-offset-4">
          See all
        </Link>
      </div>
      <ul className="flex snap-x snap-mandatory gap-4 overflow-x-auto lg:grid lg:grid-cols-3 lg:overflow-visible">
        {posts.map((post) => {
          const author = post.author.replace(/^@/, "");
          const likes = post.likes === 1 ? "like" : "likes";
          return (
            <li key={post.id} className="w-[78vw] shrink-0 snap-start lg:w-auto">
              <Link
                href="/trending"
                className="grid h-full gap-2 rounded-[20px] bg-panel p-5"
              >
                {post.image && (
                  <span className="relative -mx-5 -mt-5 block aspect-[16/10] overflow-hidden rounded-t-[20px] bg-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={post.image} alt="" loading="lazy" className="h-full w-full object-cover" data-testid="trending-photo" />
                  </span>
                )}
                <span className="font-display text-[20px] leading-tight">{titleFrom(post.caption)}</span>
                <span className="text-[17px] text-muted">@{author}</span>
                <span className="mt-auto pt-1 text-[17px] font-semibold">
                  {compactCount(post.likes)} {likes}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
