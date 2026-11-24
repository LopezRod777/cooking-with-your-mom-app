import { SignOutButton } from "@clerk/nextjs";
import { ForgetOnSignOut } from "@/components/offline/ForgetOnSignOut";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { Button } from "@/components/ui/Button";

export default function NotInvitedPage() {
  return (
    <AuthFrame>
      <h1 className="font-display text-[36px] leading-[1.15] text-ink lg:text-[44px]">
        This kitchen is invite-only.
      </h1>
      <p className="mt-4 text-[18px] text-muted">Mama lets people in a few at a time, honey.</p>
      <div className="mt-8">
        <ForgetOnSignOut>
          <SignOutButton>
          <Button variant="ghost" size="md">
            Sign out
          </Button>
        </SignOutButton>
        </ForgetOnSignOut>
      </div>
    </AuthFrame>
  );
}
