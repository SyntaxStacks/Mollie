"use client";

import Link from "next/link";
import { FormEvent, useState, useTransition } from "react";

import { Button, Card, StatusPill } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";
import { currency, useAuthedResource } from "../../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function InventoryPage() {
  const auth = useAuth();
  const { data, error, refresh } = useAuthedResource<{
    items: Array<{
      id: string;
      title: string;
      sku: string;
      category: string;
      status: string;
      priceRecommendation: number | null;
      sourceLot: { title: string } | null;
    }>;
  }>("/api/inventory", auth.token);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/inventory`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.token}`
          },
          body: JSON.stringify({
            title: formData.get("title"),
            category: formData.get("category"),
            condition: formData.get("condition"),
            brand: formData.get("brand"),
            quantity: Number(formData.get("quantity")),
            costBasis: Number(formData.get("costBasis")),
            estimatedResaleMin: Number(formData.get("estimatedResaleMin")),
            estimatedResaleMax: Number(formData.get("estimatedResaleMax")),
            priceRecommendation: Number(formData.get("priceRecommendation")),
            attributes: {}
          })
        });
        const payload = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Could not create item");
        }

        setSubmitError(null);
        event.currentTarget.reset();
        await refresh();
      } catch (caughtError) {
        setSubmitError(caughtError instanceof Error ? caughtError.message : "Could not create item");
      }
    });
  }

  return (
    <ProtectedView>
      <AppShell title="Inventory">
        <div className="grid-2">
          <Card eyebrow="Manual entry" title="Create inventory before lot ingestion exists">
            <form className="form-grid" onSubmit={handleCreate}>
              <label className="label">
                Title
                <input className="field" name="title" required />
              </label>
              <label className="label">
                Brand
                <input className="field" name="brand" />
              </label>
              <label className="label">
                Category
                <input className="field" name="category" defaultValue="Apparel" required />
              </label>
              <label className="label">
                Condition
                <input className="field" name="condition" defaultValue="Good used condition" required />
              </label>
              <label className="label">
                Quantity
                <input className="field" min="1" name="quantity" type="number" defaultValue="1" required />
              </label>
              <label className="label">
                Cost basis
                <input className="field" min="0" name="costBasis" type="number" defaultValue="10" required />
              </label>
              <label className="label">
                Resale min
                <input className="field" min="0" name="estimatedResaleMin" type="number" defaultValue="25" required />
              </label>
              <label className="label">
                Resale max
                <input className="field" min="0" name="estimatedResaleMax" type="number" defaultValue="45" required />
              </label>
              <label className="label">
                Price recommendation
                <input className="field" min="0" name="priceRecommendation" type="number" defaultValue="35" required />
              </label>
              <div className="actions">
                <Button type="submit" disabled={pending}>
                  {pending ? "Creating…" : "Create item"}
                </Button>
              </div>
            </form>
            {submitError ? <div className="notice">{submitError}</div> : null}
          </Card>

          <Card eyebrow="Guideline" title="Canonical inventory first">
            <p className="muted">
              Marketplace listings are projections of inventory items. Keep title, category, condition, and unit
              economics clean here before generating drafts.
            </p>
          </Card>
        </div>

        <Card eyebrow="Inventory list" title="All inventory">
          {error ? <div className="notice">{error}</div> : null}
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th>Status</th>
                <th>Category</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link href={`/inventory/${item.id}`}>{item.title}</Link>
                    <div className="muted">{item.sourceLot?.title ?? "Manual item"}</div>
                  </td>
                  <td>{item.sku}</td>
                  <td>
                    <StatusPill status={item.status} />
                  </td>
                  <td>{item.category}</td>
                  <td>{currency(item.priceRecommendation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </AppShell>
    </ProtectedView>
  );
}
