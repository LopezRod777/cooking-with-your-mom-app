import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { fontVariables } from "../fonts";
import "../globals.css";

export const metadata: Metadata = {
  title: "Cooking with your Mom",
  description: "Weekly meal plans, shopping lists and recipes, cooked with your Mom.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Mama", statusBarStyle: "default" },
  icons: {
    icon: "/icon.svg",
    apple: "/icons/icon-180.png",
  },
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#c93a24",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fontVariables} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="ambient" aria-hidden="true" />
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          afterSignOutUrl="/sign-in"
          localization={{
            signIn: {
              start: {
                title: "Come on in, honey.",
                titleCombined: "Come on in, honey.",
                subtitle: "Sign in and dinner's handled.",
                subtitleCombined: "Sign in and dinner's handled.",
              },
            },
            signUp: {
              start: {
                title: "Pull up a chair.",
                titleCombined: "Pull up a chair.",
                subtitle: "Create your account and you're on Mama's list.",
                subtitleCombined: "Create your account and you're on Mama's list.",
              },
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
