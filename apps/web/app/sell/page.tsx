import { redirect } from "next/navigation";

export default async function SellPage({
  searchParams
}: {
  searchParams?: Promise<{ focus?: string | string[] | undefined }>;
}) {
  const params = (await searchParams) ?? {};
  const focus = Array.isArray(params.focus) ? params.focus[0] : params.focus;

  redirect(focus ? `/inventory/${focus}` : "/inventory");
}
