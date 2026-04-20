import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Browser } from "@playwright/test";
import {
  applyCrawlerHarvest,
  classifyIdentifier,
  extractRankedProductImageUrlsFromHtml,
  normalizeIdentifier
} from "@reselleros/catalog";

export type ParsedCandidate = {
  market: "GOOGLE" | "AMAZON" | "EBAY";
  title: string | null;
  url: string | null;
  price?: number | null;
  imageUrl?: string | null;
};

export function parseGoogleSearchHtml(html: string): ParsedCandidate | null {
  const titleMatch = html.match(/<h3[^>]*>(.*?)<\/h3>/is);
  const hrefMatch = html.match(/<a[^>]+href="(https?:\/\/[^"]+)"/i);

  if (!titleMatch && !hrefMatch) {
    return null;
  }

  return {
    market: "GOOGLE",
    title: titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() ?? null,
    url: hrefMatch?.[1] ?? null
  };
}

export function parseAmazonSearchHtml(html: string): ParsedCandidate | null {
  const titleMatch = html.match(/data-cy="title-recipe"[^>]*>.*?<h2[^>]*>(.*?)<\/h2>/is) ?? html.match(/<span class="a-size-base-plus[^"]*"[^>]*>(.*?)<\/span>/is);
  const hrefMatch = html.match(/href="(\/[^"]*\/dp\/[A-Z0-9]{10}[^"]*)"/i);
  const priceWhole = html.match(/a-price-whole[^>]*>([\d,]+)/i)?.[1] ?? null;
  const priceFraction = html.match(/a-price-fraction[^>]*>(\d{2})/i)?.[1] ?? "00";
  const imageUrls = extractRankedProductImageUrlsFromHtml(html, {
    pageUrl: "https://www.amazon.com"
  });

  if (!titleMatch && !hrefMatch) {
    return null;
  }

  return {
    market: "AMAZON",
    title: titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() ?? null,
    url: hrefMatch?.[1] ? `https://www.amazon.com${hrefMatch[1]}` : null,
    price: priceWhole ? Number(`${priceWhole.replace(/,/g, "")}.${priceFraction}`) : null,
    imageUrl: imageUrls[0] ?? null
  };
}

export function parseEbaySearchHtml(html: string): ParsedCandidate | null {
  const titleMatch = html.match(/s-item__title[^>]*>(.*?)<\/span>/is);
  const hrefMatch = html.match(/s-item__link[^>]+href="([^"]+)"/i);
  const priceMatch = html.match(/s-item__price[^>]*>\$([\d,.]+)/i);
  const imageMatch = html.match(/s-item__image-img[^>]+src="([^"]+)"/i);

  if (!titleMatch && !hrefMatch) {
    return null;
  }

  return {
    market: "EBAY",
    title: titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() ?? null,
    url: hrefMatch?.[1] ?? null,
    price: priceMatch?.[1] ? Number(priceMatch[1].replace(/,/g, "")) : null,
    imageUrl: imageMatch?.[1] ?? null
  };
}

function scoreCandidates(candidates: ParsedCandidate[]) {
  const titled = candidates.filter((candidate) => candidate.title);
  const imageful = candidates.filter((candidate) => candidate.imageUrl);
  const priced = candidates.filter((candidate) => typeof candidate.price === "number" && Number.isFinite(candidate.price));
  const titleSet = new Set(titled.map((candidate) => candidate.title?.toLowerCase()).filter(Boolean));

  let confidence = 0;
  confidence += titled.length >= 2 ? 0.35 : titled.length === 1 ? 0.15 : 0;
  confidence += priced.length >= 1 ? 0.2 : 0;
  confidence += imageful.length >= 1 ? 0.15 : 0;
  confidence += titleSet.size === 1 && titled.length >= 2 ? 0.25 : 0;

  return Math.min(confidence, 0.95);
}

function pickCanonicalTitle(candidates: ParsedCandidate[]) {
  return candidates.find((candidate) => candidate.market === "AMAZON" && candidate.title)?.title
    ?? candidates.find((candidate) => candidate.market === "GOOGLE" && candidate.title)?.title
    ?? candidates.find((candidate) => candidate.market === "EBAY" && candidate.title)?.title
    ?? null;
}

function collectImageUrls(candidates: ParsedCandidate[]) {
  return [...new Set(candidates.map((candidate) => candidate.imageUrl?.trim()).filter((value): value is string => Boolean(value)))];
}

function buildSourceReferences(candidates: ParsedCandidate[]) {
  return candidates
    .filter((candidate) => candidate.url)
    .map((candidate) => ({
      market: candidate.market,
      label: `${candidate.market} search result`,
      url: candidate.url as string
    }));
}

function buildObservations(candidates: ParsedCandidate[]) {
  return candidates
    .filter((candidate) => typeof candidate.price === "number" && Number.isFinite(candidate.price))
    .map((candidate) => ({
      market: candidate.market,
      label: candidate.market === "AMAZON" ? "Amazon" : candidate.market === "EBAY" ? "eBay" : "Google",
      price: candidate.price ?? null,
      sourceUrl: candidate.url,
      note: "Captured by the local identifier crawler."
    }));
}

async function crawlUrl(browser: Browser, url: string, parser: (html: string) => ParsedCandidate | null, screenshotPath: string) {
  const page = await browser.newPage();

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    await page.screenshot({
      path: screenshotPath,
      fullPage: false
    });
    const html = await page.content();
    return parser(html);
  } finally {
    await page.close();
  }
}

export async function crawlIdentifier(input: {
  identifier: string;
  artifactDir: string;
}) {
  const normalizedIdentifier = normalizeIdentifier(input.identifier);
  const identifierType = classifyIdentifier(normalizedIdentifier);
  const browser = await chromium.launch({
    headless: true
  });

  try {
    await mkdir(input.artifactDir, {
      recursive: true
    });

    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(`${identifierType} ${normalizedIdentifier}`)}`;
    const amazonUrl = `https://www.amazon.com/s?k=${encodeURIComponent(normalizedIdentifier)}`;
    const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(normalizedIdentifier)}`;

    const [googleCandidate, amazonCandidate, ebayCandidate] = await Promise.all([
      crawlUrl(browser, googleUrl, parseGoogleSearchHtml, path.join(input.artifactDir, `${normalizedIdentifier}-google.png`)),
      crawlUrl(browser, amazonUrl, parseAmazonSearchHtml, path.join(input.artifactDir, `${normalizedIdentifier}-amazon.png`)),
      crawlUrl(browser, ebayUrl, parseEbaySearchHtml, path.join(input.artifactDir, `${normalizedIdentifier}-ebay.png`))
    ]);

    const candidates = [googleCandidate, amazonCandidate, ebayCandidate].filter((candidate): candidate is ParsedCandidate => Boolean(candidate));
    const confidenceScore = scoreCandidates(candidates);
    const title = pickCanonicalTitle(candidates);
    const imageUrls = collectImageUrls(candidates);
    const sourceReferences = buildSourceReferences(candidates);
    const observations = buildObservations(candidates);

    await writeFile(
      path.join(input.artifactDir, `${normalizedIdentifier}-summary.json`),
      JSON.stringify(
        {
          normalizedIdentifier,
          identifierType,
          confidenceScore,
          candidates
        },
        null,
        2
      ),
      "utf8"
    );

    await applyCrawlerHarvest({
      identifier: normalizedIdentifier,
      identifierType,
      title,
      imageUrls,
      sourceReferences,
      observations,
      confidenceScore
    });

    return {
      normalizedIdentifier,
      identifierType,
      confidenceScore,
      candidates
    };
  } finally {
    await browser.close();
  }
}
