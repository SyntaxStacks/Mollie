"use client";

import { FormEvent, useState, useTransition } from "react";

import { Button, Card, StatusPill } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";
import { currency, formatDate, useAuthedResource } from "../../lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function SalesPage() {
  const auth = useAuth();
  const sales = useAuthedResource<{
    sales: Array<{
      id: string;
      soldPrice: number;
      fees: number;
      shippingCost: number | null;
      soldAt: string;
      payoutStatus: string;
      inventoryItem: { title: string };
    }>;
  }>("/api/sales", auth.token);
  const inventory = useAuthedResource<{
    items: Array<{ id: string; title: string }>;
  }>("/api/inventory", auth.token);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleManualSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const response = await fetch(`${API_BASE_URL}/api/sales/manual`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`
        },
        body: JSON.stringify({
          inventoryItemId: formData.get("inventoryItemId"),
          soldPrice: Number(formData.get("soldPrice")),
          fees: Number(formData.get("fees")),
          shippingCost: Number(formData.get("shippingCost"))
        })
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? "Could not record sale");
        return;
      }

      setError(null);
      form.reset();
      await sales.refresh();
      await inventory.refresh();
    });
  }

  return (
    <ProtectedView>
      <AppShell title="Sales">
        <div className="grid-2">
          <Card eyebrow="Sales" title="Record a sold item">
            <form className="stack" onSubmit={handleManualSale}>
              <label className="label">
                Inventory item
                <select className="select" name="inventoryItemId" required>
                  <option value="">Select inventory item</option>
                  {(inventory.data?.items ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label">
                Sold price
                <input className="field" min="0" name="soldPrice" type="number" defaultValue="50" required />
              </label>
              <label className="label">
                Fees
                <input className="field" min="0" name="fees" type="number" defaultValue="7" required />
              </label>
              <label className="label">
                Shipping cost
                <input className="field" min="0" name="shippingCost" type="number" defaultValue="0" required />
              </label>
              {error ? <div className="notice">{error}</div> : null}
              <Button type="submit" disabled={pending}>
                Record sale
              </Button>
            </form>
          </Card>

          <Card eyebrow="Sync" title="Manual fallback">
            <p className="muted">
              Automatic sold sync can keep improving later. Manual entry keeps payout tracking and inventory cleanup
              moving today.
            </p>
          </Card>
        </div>

        <Card eyebrow="History" title="Recorded sales">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Sold</th>
                <th>Fees + shipping</th>
                <th>Payout</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {(sales.data?.sales ?? []).map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.inventoryItem.title}</td>
                  <td>{currency(sale.soldPrice)}</td>
                  <td>{currency(sale.fees + (sale.shippingCost ?? 0))}</td>
                  <td>
                    <StatusPill status={sale.payoutStatus} />
                  </td>
                  <td>{formatDate(sale.soldAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </AppShell>
    </ProtectedView>
  );
}
