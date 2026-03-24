import type { Metadata } from "next";

import { sharedStyles } from "@reselleros/ui";

import { AuthProvider } from "../components/auth-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: "Mollie | ResellerOS MVP",
  description: "Operator dashboard for liquidation sourcing, AI listings, and crosslisting."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <style dangerouslySetInnerHTML={{ __html: sharedStyles }} />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
