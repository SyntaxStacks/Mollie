import { redirect } from "next/navigation";

export default function ScanPage() {
  redirect("/inventory?scan=barcode");
}
