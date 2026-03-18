import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({
  getConfig: vi.fn(() => ({
    server: {},
    model: { default: "qwen_3_5_ksg_gmzz" },
    api: { base_url: "https://chatgpt.com/backend-api" },
    client: { app_version: "1.0.0" },
  })),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(() => "mock-models-yaml"),
    writeFileSync: vi.fn(),
    writeFile: vi.fn((_p: string, _d: string, _e: string, cb: (err: Error | null) => void) => cb(null)),
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
  };
});

vi.mock("js-yaml", () => ({
  default: {
    load: vi.fn(() => ({
      models: [
        {
          id: "gpt-5.4",
          displayName: "gpt-5.4",
          description: "Latest frontier agentic coding model.",
          supportedReasoningEfforts: [],
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

import { getPublicModelName, loadStaticModels } from "../model-store.js";

describe("getPublicModelName", () => {
  beforeEach(() => {
    loadStaticModels();
  });

  it("returns the public alias for canonical model ids", () => {
    expect(getPublicModelName("gpt-5.4")).toBe("qwen_3_5_ksg_gmzz");
  });

  it("never leaks suffixes in outward-facing model names", () => {
    expect(getPublicModelName("qwen_3_5_ksg_gmzz-high-fast")).toBe("qwen_3_5_ksg_gmzz");
    expect(getPublicModelName("gpt-5.4-high-fast")).toBe("qwen_3_5_ksg_gmzz");
  });
});