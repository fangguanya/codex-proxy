import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import { resolve } from "path";

const SETUP_SCRIPT = resolve(__dirname, "../../../scripts/setup-curl.ts");
const TSX_CLI = resolve(__dirname, "../../../node_modules/tsx/dist/cli.mjs");

describe("setup-curl --arch flag", () => {
  it("uses --arch override in platform line", () => {
    const output = execFileSync(
      process.execPath,
      [TSX_CLI, SETUP_SCRIPT, "--check", "--arch", "x64"],
      { encoding: "utf-8", timeout: 30_000 },
    );
    // Should report x64 as target, with cross-compilation note if host differs
    expect(output).toContain(`${process.platform}-x64`);
    if (process.arch !== "x64") {
      expect(output).toContain(`cross: host=${process.arch}`);
    }
  });

  it("defaults to host arch without --arch flag", () => {
    const output = execFileSync(
      process.execPath,
      [TSX_CLI, SETUP_SCRIPT, "--check"],
      { encoding: "utf-8", timeout: 30_000 },
    );
    expect(output).toContain(`${process.platform}-${process.arch}`);
    expect(output).not.toContain("cross:");
  });
});
