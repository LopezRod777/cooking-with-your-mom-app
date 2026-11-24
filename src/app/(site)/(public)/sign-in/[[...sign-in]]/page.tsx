import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { signupMode } from "@/lib/auth/requireUser";

const appearance = {
  variables: {
    colorPrimary: "#c93a24",
    colorBackground: "#fffcf7",
    fontFamily: "var(--font-body)",
    borderRadius: "16px",
  },
  elements: {
    footer: { display: "none" },
    // "Come on in, honey." stands alone: no subtitle under it.
    headerSubtitle: { display: "none" },
  },
};

export default function SignInPage() {
  // Sign-in-or-up only when the door takes new people (waitlist/open). In invite mode an unknown email is a dead
  // end either way, so the screen does not offer to create an account it would then turn away.
  const withSignUp = signupMode() !== "invite";
  return (
    <AuthFrame>
      <Suspense fallback={null}>
        <SignIn routing="path" path="/sign-in" withSignUp={withSignUp} appearance={appearance} />
      </Suspense>
    </AuthFrame>
  );
}
