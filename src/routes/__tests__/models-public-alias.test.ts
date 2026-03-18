import { beforeEach, describe, expect, it, vi } from "vitest";

const mockConfig = {
  server: { proxy_api_key: null as string | null },
  model: { default: "qwen_3_5_ksg_gmzz" },
};

vi.mock("../../config.js", () => ({
  getConfig: vi.fn(() => mockConfig),
}));

vi.mock("../../paths.js", () => ({
  getConfigDir: vi.fn(() => "/tmp/test-model-public-alias"),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(() => "models: []"),
    writeFile: vi.fn((_p: string, _d: string, _e: string, cb: (err: Error | null) => void) => cb(null)),
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

import { loadStaticModels } from "../../models/model-store.js";
import { createModelRoutes } from "../models.js";

describe("public model list uses only the external alias", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadStaticModels();
  });

  it("returns only qwen_3_5_ksg_gmzz from /v1/models", async () => {
    const app = createModelRoutes();
    const res = await app.request("/v1/models");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      expect.objectContaining({ id: "qwen_3_5_ksg_gmzz" }),
    ]);
  });
});