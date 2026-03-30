import { createHash, createHmac } from "node:crypto";

import type { CatalogLookupItem, CatalogLookupResult, CatalogLookupStatus, OperatorHint } from "@reselleros/types";

type AmazonLookupInput = {
  barcode?: string | null;
  amazonAsin?: string | null;
};

type AmazonCatalogConfig = {
  mode: "MANUAL" | "FIXTURE" | "AMAZON_PAAPI5";
  accessKey?: string;
  secretKey?: string;
  partnerTag?: string;
  host: string;
  region: string;
};

const AMAZON_RESOURCES = [
  "Images.Primary.Large",
  "Images.Variants.Large",
  "ItemInfo.ByLineInfo",
  "ItemInfo.Classifications",
  "ItemInfo.ExternalIds",
  "ItemInfo.Title",
  "Offers.Listings.Price",
  "OffersV2.Listings.Price"
];

function createHint(input: {
  title: string;
  explanation: string;
  severity: OperatorHint["severity"];
  nextActions: string[];
  canContinue?: boolean;
  helpText?: string | null;
}) {
  return {
    title: input.title,
    explanation: input.explanation,
    severity: input.severity,
    nextActions: input.nextActions,
    canContinue: input.canContinue,
    helpText: input.helpText ?? null
  } satisfies OperatorHint;
}

function normalizeLookupMode(raw: string | undefined) {
  switch ((raw ?? "manual").trim().toLowerCase()) {
    case "fixture":
      return "FIXTURE";
    case "amazon_paapi5":
      return "AMAZON_PAAPI5";
    default:
      return "MANUAL";
  }
}

function getAmazonCatalogConfig(): AmazonCatalogConfig {
  return {
    mode: normalizeLookupMode(process.env.AMAZON_CATALOG_LOOKUP_MODE),
    accessKey: process.env.AMAZON_PAAPI_ACCESS_KEY?.trim(),
    secretKey: process.env.AMAZON_PAAPI_SECRET_KEY?.trim(),
    partnerTag: process.env.AMAZON_PAAPI_PARTNER_TAG?.trim(),
    host: process.env.AMAZON_PAAPI_HOST?.trim() || "webservices.amazon.com",
    region: process.env.AMAZON_PAAPI_REGION?.trim() || "us-east-1"
  };
}

function createResult(input: {
  mode: CatalogLookupResult["mode"];
  status: CatalogLookupStatus;
  query: CatalogLookupResult["query"];
  item?: CatalogLookupItem | null;
  hint?: OperatorHint | null;
}): CatalogLookupResult {
  return {
    provider: "AMAZON",
    mode: input.mode,
    status: input.status,
    query: input.query,
    item: input.item ?? null,
    hint: input.hint ?? null
  };
}

function dedupeUrls(urls: Array<string | null | undefined>) {
  return [...new Set(urls.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function getItemPrice(item: Record<string, any>) {
  const oldPrice = item.Offers?.Listings?.[0]?.Price;
  const newPrice = item.OffersV2?.Listings?.[0]?.Price;
  const candidate = newPrice ?? oldPrice ?? null;

  if (!candidate) {
    return null;
  }

  const amount = Number(candidate.Amount ?? candidate.DisplayAmount?.replace(/[^0-9.]/g, "") ?? NaN);

  if (!Number.isFinite(amount)) {
    return null;
  }

  return {
    amount,
    displayAmount: typeof candidate.DisplayAmount === "string" ? candidate.DisplayAmount : `$${amount.toFixed(2)}`
  };
}

function getItemImages(item: Record<string, any>) {
  const primary = item.Images?.Primary?.Large?.URL ?? item.Images?.Primary?.Medium?.URL ?? null;
  const variants = Array.isArray(item.Images?.Variants)
    ? item.Images.Variants.map((variant: Record<string, any>) => variant?.Large?.URL ?? variant?.Medium?.URL ?? null)
    : [];

  return dedupeUrls([primary, ...variants]);
}

function serializeAmazonItem(item: Record<string, any>) {
  const price = getItemPrice(item);
  const imageUrls = getItemImages(item);
  const asin = typeof item.ASIN === "string" ? item.ASIN : null;
  const title =
    item.ItemInfo?.Title?.DisplayValue ??
    item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue ??
    "Imported Amazon item";

  return {
    title,
    brand:
      item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue ??
      item.ItemInfo?.ByLineInfo?.Manufacturer?.DisplayValue ??
      null,
    category: item.ItemInfo?.Classifications?.ProductGroup?.DisplayValue ?? null,
    amazonUrl: item.DetailPageURL ?? null,
    amazonAsin: asin,
    imageUrls,
    observations: price
      ? [
          {
            market: "AMAZON",
            label: "Amazon",
            price: price.amount,
            sourceUrl: item.DetailPageURL ?? null,
            note: "Auto-filled from Amazon Product Advertising API."
          }
        ]
      : []
  } satisfies CatalogLookupItem;
}

function scoreSearchMatch(item: Record<string, any>, barcode: string) {
  const normalized = barcode.replace(/\D/g, "");
  const candidates = [
    ...(item.ItemInfo?.ExternalIds?.UPCs?.DisplayValues ?? []),
    ...(item.ItemInfo?.ExternalIds?.EANs?.DisplayValues ?? []),
    ...(item.ItemInfo?.ExternalIds?.ISBNs?.DisplayValues ?? [])
  ]
    .map((value: unknown) => (typeof value === "string" ? value.replace(/\D/g, "") : ""))
    .filter(Boolean);

  if (candidates.includes(normalized)) {
    return 100;
  }

  return candidates.some((candidate) => candidate.includes(normalized) || normalized.includes(candidate)) ? 50 : 0;
}

function selectBestSearchItem(items: Array<Record<string, any>>, barcode: string) {
  return [...items].sort((left, right) => scoreSearchMatch(right, barcode) - scoreSearchMatch(left, barcode))[0] ?? null;
}

function fixtureLookup(input: AmazonLookupInput): CatalogLookupResult {
  const key = (input.amazonAsin?.trim() || input.barcode?.trim() || "AMAZON-FIXTURE").toUpperCase();

  return createResult({
    mode: "FIXTURE",
    status: "READY",
    query: {
      barcode: input.barcode ?? null,
      amazonAsin: input.amazonAsin ?? null
    },
    item: {
      title: `Amazon Fixture Item ${key}`,
      brand: "Amazon Fixture",
      category: "Media",
      amazonUrl: `https://www.amazon.com/dp/${key.slice(0, 10).padEnd(10, "X")}`,
      amazonAsin: key.slice(0, 10).padEnd(10, "X"),
      imageUrls: [
        "https://m.media-amazon.com/images/I/fixture-one.jpg",
        "https://m.media-amazon.com/images/I/fixture-two.jpg"
      ],
      observations: [
        {
          market: "AMAZON",
          label: "Amazon",
          price: 39.99,
          sourceUrl: `https://www.amazon.com/dp/${key.slice(0, 10).padEnd(10, "X")}`,
          note: "Fixture catalog response used for automated tests."
        }
      ]
    },
    hint: createHint({
      title: "Amazon lookup ready",
      explanation: "Amazon catalog lookup is returning a fixture response in this environment.",
      severity: "INFO",
      nextActions: ["Review the imported title, price, and image URLs before creating the item."],
      canContinue: true
    })
  });
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function formatAmzDate(date: Date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8)
  };
}

async function callAmazonPaapi(
  config: Required<Pick<AmazonCatalogConfig, "accessKey" | "secretKey" | "partnerTag" | "host" | "region">>,
  input: {
    path: string;
    target: string;
    payload: Record<string, unknown>;
  }
) {
  const body = JSON.stringify(input.payload);
  const { amzDate, dateStamp } = formatAmzDate(new Date());
  const canonicalHeaders = [
    `content-encoding:amz-1.0`,
    `content-type:application/json; charset=utf-8`,
    `host:${config.host}`,
    `x-amz-date:${amzDate}`,
    `x-amz-target:${input.target}`
  ].join("\n");
  const signedHeaders = "content-encoding;content-type;host;x-amz-date;x-amz-target";
  const canonicalRequest = ["POST", input.path, "", canonicalHeaders, "", signedHeaders, sha256Hex(body)].join("\n");
  const credentialScope = `${dateStamp}/${config.region}/ProductAdvertisingAPI/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretKey}`, dateStamp), config.region), "ProductAdvertisingAPI"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`https://${config.host}${input.path}`, {
    method: "POST",
    headers: {
      "content-encoding": "amz-1.0",
      "content-type": "application/json; charset=utf-8",
      host: config.host,
      "x-amz-date": amzDate,
      "x-amz-target": input.target,
      authorization
    },
    body
  });
  const json = (await response.json().catch(() => null)) as Record<string, any> | null;

  if (!response.ok) {
    const message =
      json?.Errors?.[0]?.Message ??
      json?.__type ??
      `Amazon lookup failed with status ${response.status}`;
    throw new Error(message);
  }

  return json ?? {};
}

export async function lookupAmazonCatalog(input: AmazonLookupInput): Promise<CatalogLookupResult> {
  const config = getAmazonCatalogConfig();
  const query = {
    barcode: input.barcode?.trim() || null,
    amazonAsin: input.amazonAsin?.trim() || null
  };

  if (config.mode === "FIXTURE") {
    return fixtureLookup(input);
  }

  if (
    config.mode !== "AMAZON_PAAPI5" ||
    !config.accessKey ||
    !config.secretKey ||
    !config.partnerTag
  ) {
    return createResult({
      mode: config.mode,
      status: "NOT_CONFIGURED",
      query,
      hint: createHint({
        title: "Amazon lookup is not configured yet",
        explanation:
          "This workspace can still import from a barcode scan, but Amazon auto-fill needs approved Amazon Product Advertising API credentials before it can fetch title, price, and images automatically.",
        severity: "WARNING",
        nextActions: [
          "Add the Amazon Product Advertising API access key, secret key, and partner tag.",
          "Use the manual Amazon fields on this form until the provider is configured."
        ],
        canContinue: true,
        helpText: "Public Amazon page scraping is intentionally not used as the production data source."
      })
    });
  }

  try {
    const response = query.amazonAsin
      ? await callAmazonPaapi(
          {
            accessKey: config.accessKey,
            secretKey: config.secretKey,
            partnerTag: config.partnerTag,
            host: config.host,
            region: config.region
          },
          {
            path: "/paapi5/getitems",
            target: "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems",
            payload: {
              ItemIds: [query.amazonAsin],
              PartnerTag: config.partnerTag,
              PartnerType: "Associates",
              Resources: AMAZON_RESOURCES
            }
          }
        )
      : await callAmazonPaapi(
          {
            accessKey: config.accessKey,
            secretKey: config.secretKey,
            partnerTag: config.partnerTag,
            host: config.host,
            region: config.region
          },
          {
            path: "/paapi5/searchitems",
            target: "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems",
            payload: {
              Keywords: query.barcode,
              SearchIndex: "All",
              ItemCount: 10,
              PartnerTag: config.partnerTag,
              PartnerType: "Associates",
              Resources: AMAZON_RESOURCES
            }
          }
        );

    const items = query.amazonAsin
      ? (response.ItemsResult?.Items as Array<Record<string, any>> | undefined) ?? []
      : (response.SearchResult?.Items as Array<Record<string, any>> | undefined) ?? [];
    const selectedItem =
      query.amazonAsin && items.length > 0 ? items[0] ?? null : query.barcode ? selectBestSearchItem(items, query.barcode) : items[0] ?? null;

    if (!selectedItem) {
      return createResult({
        mode: "AMAZON_PAAPI5",
        status: "NOT_FOUND",
        query,
        hint: createHint({
          title: "Amazon did not return a matching catalog item",
          explanation:
            "Mollie could not find a reliable Amazon catalog match for this barcode or ASIN. You can still continue by filling the fields manually.",
          severity: "WARNING",
          nextActions: [
            "Check that the barcode or ASIN is correct.",
            "Paste the Amazon details manually if you still want to create the item."
          ],
          canContinue: true
        })
      });
    }

    return createResult({
      mode: "AMAZON_PAAPI5",
      status: "READY",
      query,
      item: serializeAmazonItem(selectedItem),
      hint: createHint({
        title: "Amazon details imported",
        explanation: "Mollie pulled title, price, and image data from Amazon for this barcode or ASIN.",
        severity: "SUCCESS",
        nextActions: ["Review the imported details before creating the item."],
        canContinue: true
      })
    });
  } catch (error) {
    return createResult({
      mode: "AMAZON_PAAPI5",
      status: "ERROR",
      query,
      hint: createHint({
        title: "Amazon lookup failed",
        explanation: error instanceof Error ? error.message : "Amazon lookup failed unexpectedly.",
        severity: "ERROR",
        nextActions: [
          "Retry the lookup in a moment.",
          "If the error persists, continue with manual Amazon fields instead of blocking the import."
        ],
        canContinue: true
      })
    });
  }
}
