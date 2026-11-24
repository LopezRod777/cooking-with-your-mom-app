import { describe, expect, it } from "vitest";
import {
  PRICES,
  formatAvg,
  formatMoney,
  formatPerServingAvg,
  formatPrice,
  formatStorePrice,
  krogerSourceLine,
  priceFor,
  quotedLine,
  quotedTime,
} from "../prices";

describe("prices", () => {
  it("formats prices as national averages", () => {
    expect(formatAvg(5.9)).toBe("$5.90 (est.)");
    expect(formatAvg(5.9, "eggs")).toBe("$5.90 (avg)");
    expect(formatAvg(5.9, "salmon")).toBe("$5.90 (est.)");
    expect(formatPerServingAvg(1.5)).toBe("$1.50 / serving (est.)");
  });

  it("keeps only positive finite numbers", () => {
    for (const usd of Object.values(PRICES)) {
      expect(typeof usd).toBe("number");
      expect(Number.isFinite(usd)).toBe(true);
      expect(usd).toBeGreaterThan(0);
    }
  });
});

describe("priceFor and formatPrice", () => {
  const live = {
    store: { locationId: "01400943", name: "King Soopers Table Mesa" },
    quotedAt: "2026-10-31T19:12:00.000Z",
    prices: {
      eggs: { regular: 4.5, promo: 3.99, size: "12 ct" },
      salmon: { regular: 10.5, size: "1 lb" },
    },
  };

  it("store beats avg and est; promo wins over regular", () => {
    expect(priceFor("eggs", live)).toEqual({ usd: 3.99, basis: "store", promo: 3.99 });
    expect(priceFor("salmon", live)).toEqual({ usd: 10.5, basis: "store" });
  });

  it("falls back to avg, then est, then none when no live quote has the key", () => {
    expect(priceFor("eggs", null)).toEqual({ usd: PRICES.eggs, basis: "avg" });
    expect(priceFor("eggs", { ...live, prices: {} })).toEqual({ usd: PRICES.eggs, basis: "avg" });
    expect(priceFor("salmon")).toEqual({ usd: PRICES.salmon, basis: "est" });
    expect(priceFor("not_a_real_key", live)).toEqual({ usd: null, basis: "none" });
  });

  it("formats each basis", () => {
    expect(formatPrice(4.99, "store", "King Soopers")).toBe("$4.99 (King Soopers)");
    expect(formatPrice(4.99, "store")).toBe("$4.99 (store)");
    expect(formatPrice(2.27, "avg")).toBe("$2.27 (avg)");
    expect(formatPrice(1.1, "est")).toBe("$1.10 (est.)");
    expect(formatPrice(null, "none")).toBe("no price");
  });

  it("formats a sale as returned: regular and sale price", () => {
    expect(formatPrice(3.99, "store", "King Soopers", 4.5)).toBe("$4.50 · sale $3.99 (King Soopers)");
    expect(formatPrice(4.5, "store", "King Soopers", 4.5)).toBe("$4.50 (King Soopers)");
  });

  it("formatStorePrice drops the store name and shows the sale only when promo is below regular", () => {
    expect(formatStorePrice(3.99, 4.5)).toBe("$3.99 sale (was $4.50)");
    expect(formatStorePrice(4.5, 4.5)).toBe("$4.50");
    expect(formatStorePrice(2.49)).toBe("$2.49");
  });

  it("quotedLine names the store and the time", () => {
    expect(quotedLine(live)).toBe(
      `Quoted ${quotedTime(live.quotedAt)} at King Soopers Table Mesa; tax and deposits not included.`,
    );
  });
});

describe("formatMoney", () => {
  it("prints two decimals when the value has at most two", () => {
    expect(formatMoney(3.99)).toBe("$3.99");
    expect(formatMoney(4.5)).toBe("$4.50");
    expect(formatMoney(3)).toBe("$3.00");
  });

  it("prints the number as returned when it has more than two decimals", () => {
    expect(formatMoney(1.234)).toBe("$1.234");
    expect(formatStorePrice(1.234)).toBe("$1.234");
    expect(formatPrice(1.234, "store", "King Soopers")).toBe("$1.234 (King Soopers)");
  });

  it("store prices in sale lines use the same rule", () => {
    expect(formatStorePrice(3.99, 4.5)).toBe("$3.99 sale (was $4.50)");
    expect(formatPrice(3.99, "store", "King Soopers", 4.5)).toBe("$4.50 · sale $3.99 (King Soopers)");
  });

  it("krogerSourceLine is the one muted line with store, time and the terms", () => {
    const live = {
      store: { locationId: "01400943", name: "King Soopers Table Mesa" },
      quotedAt: "2026-10-31T19:12:00.000Z",
      prices: {},
    };
    expect(krogerSourceLine(live)).toBe(
      `Prices from Kroger for King Soopers Table Mesa, quoted ${quotedTime(live.quotedAt)}, shown as returned, not cached; tax and deposits not included.`,
    );
  });
});
