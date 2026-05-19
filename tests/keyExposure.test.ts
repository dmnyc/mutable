import { describe, it, expect } from "vitest";
import { deriveAddresses } from "@/lib/keyExposureService";

// Helper: index addresses by type
function byType(xonlyHex: string): Record<string, string> {
  return Object.fromEntries(
    deriveAddresses(xonlyHex).map((a) => [a.type, a.address])
  );
}

describe("deriveAddresses — BIP173 generator-point vectors", () => {
  // secp256k1 generator point G (x-only)
  const G =
    "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

  it("P2PKH-02", () => {
    expect(byType(G)["P2PKH-02"]).toBe("1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH");
  });

  it("P2WPKH-02", () => {
    expect(byType(G)["P2WPKH-02"]).toBe(
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
    );
  });
});

describe("deriveAddresses — OPENETR BIP341 Taproot vector", () => {
  // alex@gleasonator.com internal key (used by the OPENETR reference app)
  const OPENETR_KEY =
    "0461fcbecc4c3374439932d6b8f11269ccdb7cc973ad7a50ae362db135a474dd";

  it("canonical P2TR (tweaked key-path)", () => {
    expect(byType(OPENETR_KEY)["P2TR"]).toBe(
      "bc1pvdaezs0mdhxgrfhw2zjsw4r02wlzrafd7stxcvpzzscsh8hv6vhqdc9ets"
    );
  });
});

describe("deriveAddresses — output shape", () => {
  const G =
    "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

  it("returns all expected address types", () => {
    const types = deriveAddresses(G).map((a) => a.type);
    expect(types).toContain("P2PKH-02");
    expect(types).toContain("P2PKH-03");
    expect(types).toContain("P2WPKH-02");
    expect(types).toContain("P2WPKH-03");
    expect(types).toContain("P2SH-02");
    expect(types).toContain("P2SH-03");
    expect(types).toContain("P2TR");
    expect(types).toContain("P2TR-raw");
  });

  it("marks P2TR as primary", () => {
    const primary = deriveAddresses(G).find((a) => a.primary);
    expect(primary?.type).toBe("P2TR");
  });
});
