import { describe, expect, it } from "vitest";
import { parseRobots, pathAllowedBy, robotsAllows } from "../import/robots";

describe("robots.txt reader", () => {
  it("allows everything when the file is null or empty", () => {
    expect(pathAllowedBy(null, "/x")).toBe(true);
    expect(pathAllowedBy("", "/x")).toBe(true);
  });

  it("blocks a directory prefix but needs the trailing slash to match", () => {
    const txt = "User-agent: *\nDisallow: /private/";
    expect(pathAllowedBy(txt, "/private/a")).toBe(false);
    expect(pathAllowedBy(txt, "/recipes/a")).toBe(true);
    expect(pathAllowedBy(txt, "/private")).toBe(true);
  });

  it("blocks everything with Disallow: /", () => {
    const txt = "User-agent: *\nDisallow: /";
    expect(pathAllowedBy(txt, "/")).toBe(false);
    expect(pathAllowedBy(txt, "/anything/at/all")).toBe(false);
  });

  it("supports * wildcards and a trailing $ anchor", () => {
    const txt = "User-agent: *\nDisallow: /*.pdf$";
    expect(pathAllowedBy(txt, "/a/b.pdf")).toBe(false);
    expect(pathAllowedBy(txt, "/a/b.pdf?x=1")).toBe(true);
    expect(pathAllowedBy(txt, "/a/pdf")).toBe(true);
  });

  it("lets the longest matching pattern win", () => {
    const txt = "User-agent: *\nAllow: /recipes/public\nDisallow: /recipes";
    expect(pathAllowedBy(txt, "/recipes/public/x")).toBe(true);
    expect(pathAllowedBy(txt, "/recipes/secret")).toBe(false);
  });

  it("breaks ties in favour of Allow", () => {
    const txt = "User-agent: *\nAllow: /r\nDisallow: /r";
    expect(pathAllowedBy(txt, "/r/x")).toBe(true);
  });

  it("uses only the agent-specific group when one exists", () => {
    const txt =
      "User-agent: CookingWithYourMom\nDisallow: /\n\nUser-agent: *\nDisallow: /private/";
    expect(pathAllowedBy(txt, "/x", "CookingWithYourMom")).toBe(false);
    expect(pathAllowedBy(txt, "/x", "Other")).toBe(true);
    expect(pathAllowedBy(txt, "/private/x", "Other")).toBe(false);
    expect(pathAllowedBy(txt, "/private/x")).toBe(false);
  });

  it("ignores comments, blank lines, field case and whitespace", () => {
    const txt = "# hi\nUSER-AGENT: *\n  disallow : /a # comment\n\nSitemap: https://x/s.xml";
    expect(pathAllowedBy(txt, "/a/b")).toBe(false);
    expect(pathAllowedBy(txt, "/b")).toBe(true);
  });

  it("shares one group between consecutive User-agent lines", () => {
    const txt = "User-agent: A\nUser-agent: *\nDisallow: /z";
    expect(pathAllowedBy(txt, "/z", "B")).toBe(false);
  });

  it("treats an empty Disallow value as allow everything", () => {
    const txt = "User-agent: *\nDisallow:";
    expect(pathAllowedBy(txt, "/anything")).toBe(true);
  });

  it("treats regex metacharacters in patterns as literals", () => {
    const txt = "User-agent: *\nDisallow: /a+b(c)";
    expect(pathAllowedBy(txt, "/a+b(c)/x")).toBe(false);
    expect(pathAllowedBy(txt, "/aab/x")).toBe(true);
  });

  it("does not backtrack exponentially on repeated wildcards", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /" + "*a".repeat(20) + "b");
    const start = performance.now();
    const allowed = robotsAllows(rules, "/" + "a".repeat(100));
    const elapsed = performance.now() - start;
    expect(allowed).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });

  it("normalizes percent-encoded unreserved characters on both sides", () => {
    expect(pathAllowedBy("User-agent: *\nDisallow: /private", "/%70rivate")).toBe(false);
    expect(pathAllowedBy("User-agent: *\nDisallow: /%70rivate", "/private")).toBe(false);
  });

  it("keeps reserved encoded characters encoded with uppercase hex", () => {
    expect(pathAllowedBy("User-agent: *\nDisallow: /a%2Fb", "/a%2fb")).toBe(false);
    expect(pathAllowedBy("User-agent: *\nDisallow: /a%2Fb", "/a/b")).toBe(true);
  });

  it("an incomplete parse past the rule cap is rejected, not partially applied", () => {
    const lines = ["User-agent: *"];
    for (let i = 0; i < 2000; i++) lines.push(`Disallow: /x${i}`);
    lines.push("Disallow: /target");
    const file = lines.join("\n");
    expect(pathAllowedBy(file, "/target/page")).toBe(false);
    expect(pathAllowedBy(file, "/x7/page")).toBe(false);
  });

  it("a rule whose pattern exceeds the length cap rejects the whole file", () => {
    const longPattern = "/" + "a".repeat(500);
    const file = `User-agent: *\nDisallow: ${longPattern}\nDisallow: /b`;
    expect(pathAllowedBy(file, "/b")).toBe(false);
    expect(pathAllowedBy(file, "/zzz")).toBe(false);
    expect(pathAllowedBy(file, longPattern + "/x")).toBe(false);
  });

  it("stops at the comparison budget and fails closed quickly", () => {
    const lines = ["User-agent: *"];
    for (let i = 0; i < 500; i++) lines.push("Disallow: /*" + "a".repeat(495) + "b");
    const rules = parseRobots(lines.join("\n"));
    const start = performance.now();
    const allowed = robotsAllows(rules, "/" + "a".repeat(2047));
    const elapsed = performance.now() - start;
    expect(allowed).toBe(false);
    expect(elapsed).toBeLessThan(200);
  });

  it("a path longer than the path cap is rejected, not clipped", () => {
    const file = "User-agent: *\nDisallow: /private";
    expect(pathAllowedBy(file, "/" + "a".repeat(2047))).toBe(true);
    expect(pathAllowedBy(file, "/" + "a".repeat(2048))).toBe(false);
  });

  it("a complete file is not marked truncated", () => {
    expect(parseRobots("User-agent: *\nDisallow: /a").truncated).toBe(false);
  });
});
