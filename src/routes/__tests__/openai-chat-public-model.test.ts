import { beforeEach, describe, expect, it, vi } from "vitest";

const mockConfig = {
  server: { proxy_api_key: null as string | null },
  model: {
    default: "qwen_3_5_ksg_gmzz",
    default_reasoning_effort: "medium",
  },
  auth: {
    jwt_token: undefined as string | undefined,
    rotation_strategy: "least_used" as const,
    rate_limit_backoff_seconds: 60,
  },
  api: { base_url: "https://chatgpt.com/backend-api" },
  client: { app_version: "1.0.0" },
};

const { mockCreateResponse, mockCollectCodexResponse } = vi.hoisted(() => ({
  mockCreateResponse: vi.fn(),
  mockCollectCodexResponse: vi.fn(),
}));

vi.mock("../../config.js", () => ({
  getConfig: vi.fn(() => mockConfig),
}));

vi.mock("../../utils/retry.js", () => ({
  withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../../proxy/codex-api.js", () => ({
  CodexApi: vi.fn().mockImplementation(() => ({
    createResponse: mockCreateResponse,
  })),
  CodexApiError: class extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string) {
      super(body);
      this.name = "CodexApiError";
      this.status = status;
      this.body = body;
    }
  },
}));

vi.mock("../../translation/codex-to-openai.js", () => ({
  streamCodexToOpenAI: vi.fn(async function* () {
    yield "data: [DONE]\n\n";
  }),
  collectCodexResponse: mockCollectCodexResponse,
}));

vi.mock("../../paths.js", () => ({
  getDataDir: vi.fn(() => "/tmp/test-openai-chat-data"),
  getConfigDir: vi.fn(() => "/tmp/test-openai-chat-config"),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(() => "models: []"),
    writeFileSync: vi.fn(),
    writeFile: vi.fn((_p: string, _d: string, _e: string, cb: (err: Error | null) => void) => cb(null)),
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    renameSync: vi.fn(),
  };
});

vi.mock("js-yaml", () => ({
  default: {
    load: vi.fn(() => ({
      models: [
        {
          id: "gpt-5.4",
          displayName: "GPT-5.4",
          description: "",
          isDefault: true,
          supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Default" }],
          defaultReasoningEffort: "medium",
          inputModalities: ["text"],
          supportsPersonality: false,
          upgrade: null,
        },
      ],
      aliases: {
        qwen_3_5_ksg_gmzz: "gpt-5.4",
      },
    })),
    dump: vi.fn(() => ""),
  },
}));

type MockProfile = { email: string; chatgpt_plan_type: string };

vi.mock("../../auth/jwt-utils.js", () => ({
  decodeJwtPayload: vi.fn(() => ({
    exp: Math.floor(Date.now() / 1000) + 3600,
  })),
  extractChatGptAccountId: vi.fn((token: string) => `acct-${token}`),
  extractUserProfile: vi.fn((): MockProfile => ({
    email: "team@test.com",
    chatgpt_plan_type: "team",
  })),
  isTokenExpired: vi.fn(() => false),
}));

import { AccountPool } from "../../auth/account-pool.js";
import { loadStaticModels } from "../../models/model-store.js";
import { createChatRoutes } from "../chat.js";

describe("standard OpenAI chat route", () => {
  let pool: AccountPool;

  beforeEach(() => {
    vi.clearAllMocks();
    loadStaticModels();
    pool = new AccountPool();
    pool.addAccount("team-token-1");
    mockCreateResponse.mockResolvedValue(new Response("{}"));
    mockCollectCodexResponse.mockImplementation(async (_api: unknown, _response: Response, model: string) => ({
      response: {
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 1700000000,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "杭州如果偏凉可以考虑薄外套，具体还要看实时天气。",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 12,
          total_tokens: 22,
        },
      },
      usage: {
        input_tokens: 10,
        output_tokens: 12,
      },
      responseId: "resp-test",
    }));
  });

  it("handles a normal OpenAI chat request and keeps the public model name", async () => {
    const app = createChatRoutes(pool);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen_3_5_ksg_gmzz",
        stream: false,
        messages: [
          { role: "user", content: "今天杭州天气怎样？需要穿什么衣服" },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe("qwen_3_5_ksg_gmzz");
    expect(body.choices[0].message.content).toContain("杭州");

    expect(mockCreateResponse).toHaveBeenCalledTimes(1);
    expect(mockCreateResponse.mock.calls[0][0].model).toBe("gpt-5.4");
    expect(mockCreateResponse.mock.calls[0][0].input).toEqual([
      expect.objectContaining({
        role: "user",
        content: "今天杭州天气怎样？需要穿什么衣服",
      }),
    ]);
  });

  it("handles multi-turn OpenAI dialogue while still exposing only the public model name", async () => {
    const app = createChatRoutes(pool);
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen_3_5_ksg_gmzz-high",
        stream: false,
        messages: [
          { role: "user", content: "我在杭州。" },
          { role: "assistant", content: "好的，我知道你在杭州。" },
          { role: "user", content: "那今天出门大概适合穿什么衣服？请用两句话回答。" },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe("qwen_3_5_ksg_gmzz");
    expect(body.choices[0].message.content).toContain("杭州");

    expect(mockCreateResponse).toHaveBeenCalledTimes(1);
    expect(mockCreateResponse.mock.calls[0][0].model).toBe("gpt-5.4");
    expect(mockCreateResponse.mock.calls[0][0].reasoning.effort).toBe("high");
    expect(mockCreateResponse.mock.calls[0][0].input).toEqual([
      expect.objectContaining({ role: "user", content: "我在杭州。" }),
      expect.objectContaining({ role: "assistant", content: "好的，我知道你在杭州。" }),
      expect.objectContaining({ role: "user", content: "那今天出门大概适合穿什么衣服？请用两句话回答。" }),
    ]);
  });
});