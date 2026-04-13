"use client";

import { Plus, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";

import { Button } from "@reselleros/ui";

import { SourceSearchPanel } from "./source-search-panel";

type ManualInventoryItemFormProps = {
  token: string;
  open: boolean;
  onClose: () => void;
  existingItems: Array<{
    id: string;
    title: string;
    sku?: string;
    attributesJson?: Record<string, unknown> | null;
  }>;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function normalizeIdentifier(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9X]/g, "");
}

function normalizeTitle(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function ManualInventoryItemForm({ token, open, onClose, existingItems }: ManualInventoryItemFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [lookupQuery, setLookupQuery] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [category, setCategory] = useState("General Merchandise");
  const [condition, setCondition] = useState("Good used condition");
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [costBasis, setCostBasis] = useState("0");
  const [estimatedResaleMin, setEstimatedResaleMin] = useState("");
  const [estimatedResaleMax, setEstimatedResaleMax] = useState("");
  const [priceRecommendation, setPriceRecommendation] = useState("");

  if (!open) {
    return null;
  }

  const duplicateMatches = useMemo(() => {
    const normalizedIdentifier = normalizeIdentifier(identifier);
    const normalizedTitle = normalizeTitle(title);

    return existingItems.filter((item) => {
      const itemIdentifier = typeof item.attributesJson?.identifier === "string" ? normalizeIdentifier(item.attributesJson.identifier) : "";
      const itemTitle = normalizeTitle(item.title);
      const identifierMatch = Boolean(normalizedIdentifier && itemIdentifier && normalizedIdentifier === itemIdentifier);
      const titleMatch =
        Boolean(normalizedTitle) &&
        normalizedTitle.length >= 6 &&
        (itemTitle.includes(normalizedTitle) || normalizedTitle.includes(itemTitle));

      return identifierMatch || titleMatch;
    }).slice(0, 3);
  }, [existingItems, identifier, title]);

  function resetForm() {
    setIdentifier("");
    setTitle("");
    setBrand("");
    setLookupQuery("");
    setSourceUrl("");
    setCategory("General Merchandise");
    setCondition("Good used condition");
    setSize("");
    setColor("");
    setQuantity("1");
    setCostBasis("0");
    setEstimatedResaleMin("");
    setEstimatedResaleMax("");
    setPriceRecommendation("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/inventory`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            title: title.trim(),
            brand: brand.trim() || null,
            category: category.trim(),
            condition: condition.trim(),
            size: size.trim() || null,
            color: color.trim() || null,
            quantity: Math.max(1, Number(quantity || 1)),
            costBasis: Number(costBasis || 0),
            estimatedResaleMin: estimatedResaleMin.trim() ? Number(estimatedResaleMin) : null,
            estimatedResaleMax: estimatedResaleMax.trim() ? Number(estimatedResaleMax) : null,
            priceRecommendation: priceRecommendation.trim() ? Number(priceRecommendation) : null,
            attributes: {
              importSource: lookupQuery.trim() || sourceUrl.trim() ? "MANUAL_LOOKUP" : "MANUAL_ENTRY",
              ...(lookupQuery.trim()
                ? {
                    sourceQuery: lookupQuery.trim()
                  }
                : {}),
              ...(sourceUrl.trim()
                ? {
                    primarySourceUrl: sourceUrl.trim(),
                    referenceUrls: [sourceUrl.trim()]
                  }
                : {}),
              ...(identifier.trim()
                ? {
                    identifier: normalizeIdentifier(identifier)
                  }
                : {})
            }
          })
        });
        const payload = (await response.json()) as { error?: string; item?: { id: string } };

        if (!response.ok || !payload.item?.id) {
          throw new Error(payload.error ?? "Could not create this inventory item");
        }

        resetForm();
        router.push(`/inventory/${payload.item.id}`);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Could not create this inventory item");
      }
    });
  }

  return (
    <section className="rs-card">
      <header className="rs-card-header">
        <div>
          <p className="rs-eyebrow">Manual add</p>
          <h3>Create an inventory item without scanning</h3>
        </div>
        <Button disabled={pending} kind="ghost" onClick={onClose} type="button">
          <X size={16} /> Close
        </Button>
      </header>

      <div className="stack">
        <div className="scan-import-hint">
          <Sparkles size={16} />
          <span>Use code or manual lookup to get the item moving, then finish photos, selling details, and marketplace setup on the item page.</span>
        </div>

        <SourceSearchPanel
          description="Search for product data manually when the item has no usable barcode. Paste the best source URL you find, then create the item with those details."
          query={lookupQuery}
          sourceUrl={sourceUrl}
          title="Look it up manually"
          onQueryChange={setLookupQuery}
          onSourceUrlChange={setSourceUrl}
        />

        <form className="stack" onSubmit={handleSubmit}>
          <div className="scan-import-grid">
            <label className="label">
              Identifier
              <input className="field" placeholder="Optional barcode or product code" value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
            </label>
            <label className="label">
              Title
              <input className="field" required value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="label">
              Brand
              <input className="field" value={brand} onChange={(event) => setBrand(event.target.value)} />
            </label>
            <label className="label">
              Category
              <input className="field" required value={category} onChange={(event) => setCategory(event.target.value)} />
            </label>
            <label className="label">
              Condition
              <input className="field" required value={condition} onChange={(event) => setCondition(event.target.value)} />
            </label>
            <label className="label">
              Size
              <input className="field" value={size} onChange={(event) => setSize(event.target.value)} />
            </label>
            <label className="label">
              Color
              <input className="field" value={color} onChange={(event) => setColor(event.target.value)} />
            </label>
            <label className="label">
              Quantity
              <input className="field" min="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </label>
            <label className="label">
              Buy cost
              <input className="field" min="0" step="0.01" type="number" value={costBasis} onChange={(event) => setCostBasis(event.target.value)} />
            </label>
            <label className="label">
              Suggested sell
              <input className="field" min="0" step="0.01" type="number" value={priceRecommendation} onChange={(event) => setPriceRecommendation(event.target.value)} />
            </label>
            <label className="label">
              Resale min
              <input className="field" min="0" step="0.01" type="number" value={estimatedResaleMin} onChange={(event) => setEstimatedResaleMin(event.target.value)} />
            </label>
            <label className="label">
              Resale max
              <input className="field" min="0" step="0.01" type="number" value={estimatedResaleMax} onChange={(event) => setEstimatedResaleMax(event.target.value)} />
            </label>
          </div>

          {duplicateMatches.length > 0 ? (
            <div className="notice warning">
              <strong>Possible duplicate</strong>
              <div className="muted">Mollie already has item records that look close to this manual entry.</div>
              <ul className="marketplace-hint-list">
                {duplicateMatches.map((item) => (
                  <li key={item.id}>
                    {item.title}
                    {typeof item.attributesJson?.identifier === "string" ? ` • ${item.attributesJson.identifier}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? <div className="notice">{error}</div> : null}

          <div className="actions">
            <Button data-testid="manual-inventory-create" disabled={pending} type="submit">
              <Plus size={16} /> {pending ? "Creating..." : "Create item"}
            </Button>
            <Button disabled={pending} kind="secondary" onClick={resetForm} type="button">
              Reset
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
