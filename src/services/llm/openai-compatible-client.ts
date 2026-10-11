// -- Types --------------------------------------------------------------------

type LlmErrorKind = "network" | "auth" | "not-found" | "http" | "bad-response";

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface LlmEndpoint {
  baseUrl: string;
  apiKey: string;
}

class LlmRequestError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;

  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message);
    this.name = "LlmRequestError";
    this.kind = kind;
    this.status = status;
  }
}

// -- Helpers ------------------------------------------------------------------

function endpointUrl(baseUrl: string, path: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/${path}`;
}

function requestHeaders(apiKey: string): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  if (apiKey.trim()) headers.set("authorization", `Bearer ${apiKey.trim()}`);
  return headers;
}

function classifyStatus(status: number): LlmErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not-found";
  return "http";
}

async function send(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new LlmRequestError("network", `Request to ${url} failed`);
  }
  if (!response.ok) {
    throw new LlmRequestError(classifyStatus(response.status), `${url} returned ${response.status}`, response.status);
  }
  try {
    return await response.json();
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new LlmRequestError("bad-response", `${url} returned non-JSON`);
  }
}

// -- Requests -----------------------------------------------------------------

async function chatJson(
  request: LlmEndpoint & { model: string; messages: ChatMessage[]; signal?: AbortSignal },
): Promise<string> {
  const data = await send(endpointUrl(request.baseUrl, "chat/completions"), {
    method: "POST",
    headers: requestHeaders(request.apiKey),
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
    signal: request.signal,
  });
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new LlmRequestError("bad-response", "Response had no message content");
  return content;
}

async function listModels(request: LlmEndpoint & { signal?: AbortSignal }): Promise<string[]> {
  const data = await send(endpointUrl(request.baseUrl, "models"), {
    method: "GET",
    headers: requestHeaders(request.apiKey),
    signal: request.signal,
  });
  const models = (data as { data?: unknown })?.data;
  if (!Array.isArray(models)) throw new LlmRequestError("bad-response", "Response had no model list");
  return models.flatMap((model) => (typeof model?.id === "string" ? [model.id] : []));
}

// -- Exports ------------------------------------------------------------------

export { chatJson, listModels, LlmRequestError };
export type { ChatMessage, LlmEndpoint, LlmErrorKind };
