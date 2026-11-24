import Image from "next/image";
import type { ReactNode } from "react";
import { RememberUser } from "../offline/RememberUser";

// Photo panel with the wordmark (top on phone, left on desktop) and the form side next to it.
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col lg:flex-row">
      <RememberUser />
      <section className="relative h-[38vh] shrink-0 overflow-hidden lg:h-auto lg:min-h-dvh lg:w-1/2">
        <Image
          src="/media/cuisines/italian.jpg"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-cover"
        />
        <div className="absolute inset-x-0 bottom-0 bg-paper px-6 py-5 lg:px-10 lg:py-8">
          <p className="font-[family-name:var(--font-display)] text-[32px] leading-[1.1] text-tomato lg:text-[44px]">
            Cooking with your Mom
          </p>
          {/* Mama's line, in her handwriting, as something she already said. */}
          <p className="mt-3 font-[family-name:var(--font-hand)] text-[30px] leading-[1.05] text-ink lg:text-[38px]">&ldquo;Dinner&rsquo;s handled, honey.&rdquo;</p>
          <p className="mt-1 text-[16px] text-muted">&mdash; Mama</p>
        </div>
      </section>
      <section className="flex flex-1 items-center justify-center px-4 py-10 lg:w-1/2 lg:px-10">
        <div className="w-full max-w-[420px]">{children}</div>
      </section>
    </main>
  );
}
