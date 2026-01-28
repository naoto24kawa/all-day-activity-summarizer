const ADAS_API_URL = import.meta.env.VITE_ADAS_API_URL || "http://localhost:3001";

async function fetchAdasApi<T>(path: string): Promise<T> {
  const response = await fetch(`${ADAS_API_URL}${path}`);
  if (!response.ok) {
    throw new Error(`ADAS API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function postAdasApi<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${ADAS_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`ADAS API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function deleteAdasApi<T>(path: string): Promise<T> {
  const response = await fetch(`${ADAS_API_URL}${path}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`ADAS API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export { fetchAdasApi, postAdasApi, deleteAdasApi, ADAS_API_URL };
