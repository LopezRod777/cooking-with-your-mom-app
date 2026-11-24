import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";
import { AuthFrame } from "@/components/auth/AuthFrame";

const appearance = {
  variables: {
    colorPrimary: "#c93a24",
    colorBackground: "#fffcf7",
    fontFamily: "var(--font-body)",
    borderRadius: "16px",
  },
  elements: {
    footer: { display: "none" },
  },
};

export default function SignUpPage() {
  return (
    <AuthFrame>
      <Suspense fallback={null}>
        <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" appearance={appearance} />
      </Suspense>
      <p className="mt-6 text-[17px] text-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-semibold text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  );
}
