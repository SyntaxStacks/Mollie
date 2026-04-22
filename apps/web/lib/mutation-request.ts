export function buildAuthedJsonMutationInit(token: string, body?: unknown): RequestInit {
  const headers = new Headers({
    Authorization: `Bearer ${token}`
  });

  headers.set("Content-Type", "application/json");

  return {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {})
  };
}
