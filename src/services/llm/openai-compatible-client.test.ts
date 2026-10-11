import { LlmRequestError, chatJson, listModels } from "@/services/llm/openai-compatible-client";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

const ENDPOINT = { baseUrl: "http://localhost:11434/v1/", apiKey: "" };
const MESSAGES = [{ role: "user" as const, content: "hi" }];

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => {
    if (!(response instanceof Response)) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function chatBody(content: unknown) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

describe("chatJson", () => {
  it("posts JSON-mode chat to a normalised URL without auth when no key is set", async () => {
    const fetchMock = stubFetch(chatBody("{}"));
    await chatJson({ ...ENDPOINT, model: "m", messages: MESSAGES });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "m",
      messages: MESSAGES,
      temperature: 0.3,
      response_format: { type: "json_object" },
    });
  });

  it("sends a bearer token when a key is set", async () => {
    const fetchMock = stubFetch(chatBody("{}"));
    await chatJson({ baseUrl: "https://api.example.com/v1", apiKey: "sk-test", model: "m", messages: MESSAGES });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer sk-test");
  });

  it("returns the first choice's content", async () => {
    stubFetch(chatBody('{"lines":{}}'));
    await expect(chatJson({ ...ENDPOINT, model: "m", messages: MESSAGES })).resolves.toBe('{"lines":{}}');
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [404, "not-found"],
    [500, "http"],
  ] as const)("classifies HTTP %i as %s", async (status, kind) => {
    stubFetch(new Response("nope", { status }));
    const error = await chatJson({ ...ENDPOINT, model: "m", messages: MESSAGES }).catch((e) => e);
    expect(error).toBeInstanceOf(LlmRequestError);
    expect(error).toMatchObject({ kind, status });
  });

  it("classifies a rejected fetch (offline or CORS) as network", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    await expect(chatJson({ ...ENDPOINT, model: "m", messages: MESSAGES })).rejects.toMatchObject({ kind: "network" });
  });

  it("classifies a body without string content as bad-response", async () => {
    stubFetch(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await expect(chatJson({ ...ENDPOINT, model: "m", messages: MESSAGES })).rejects.toMatchObject({
      kind: "bad-response",
    });
  });

  it("re-throws aborts unchanged", async () => {
    stubFetch(new DOMException("aborted", "AbortError"));
    await expect(chatJson({ ...ENDPOINT, model: "m", messages: MESSAGES })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("listModels", () => {
  it("returns model ids from GET /models", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }), { status: 200 }));
    await expect(listModels(ENDPOINT)).resolves.toEqual(["a", "b"]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/v1/models");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });

  it("classifies a body without a data array as bad-response", async () => {
    stubFetch(new Response(JSON.stringify({}), { status: 200 }));
    await expect(listModels(ENDPOINT)).rejects.toMatchObject({ kind: "bad-response" });
  });
});
