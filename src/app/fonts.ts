import { Caveat, Gloock, Jost } from "next/font/google";

const gloock = Gloock({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

const jost = Jost({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const caveat = Caveat({
  variable: "--font-hand",
  subsets: ["latin"],
  weight: "600",
});

// Shared by the two root layouts: the site and the no-signal page.
export const fontVariables = `${gloock.variable} ${jost.variable} ${caveat.variable}`;
