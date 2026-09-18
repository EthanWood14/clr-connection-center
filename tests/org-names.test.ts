import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { orgClientFacingName, orgInternalLabel, orgMatchesQuery } from "../shared/org-names";

describe("org dual naming", () => {
  it("uses nickname for C3-internal display when set", () => {
    assert.equal(
      orgInternalLabel({ name: "West Capital Lending", company_name: "West Capital Lending", nickname: "West Capital — Victory" }),
      "West Capital — Victory",
    );
  });

  it("falls back to name then company when nickname is null", () => {
    assert.equal(
      orgInternalLabel({ name: "Victory Desk", company_name: "West Capital Lending", nickname: null }),
      "Victory Desk",
    );
    assert.equal(
      orgInternalLabel({ name: "", companyName: "West Capital Lending", nickname: "  " }),
      "West Capital Lending",
    );
  });

  it("keeps company_name as the client-facing name", () => {
    assert.equal(
      orgClientFacingName({ name: "West Capital — Retail", company_name: "West Capital Lending", nickname: "West Capital — Retail" }),
      "West Capital Lending",
    );
    assert.equal(
      orgClientFacingName({ name: "Solo Org", company_name: "", nickname: null }),
      "Solo Org",
    );
  });

  it("matches search against nickname, name, or company", () => {
    const org = { name: "WCL Victory", company_name: "West Capital Lending", nickname: "West Capital — Victory" };
    assert.equal(orgMatchesQuery(org, "victory"), true);
    assert.equal(orgMatchesQuery(org, "capital lending"), true);
    assert.equal(orgMatchesQuery(org, "wcl"), true);
    assert.equal(orgMatchesQuery(org, "acme"), false);
    assert.equal(orgMatchesQuery(org, ""), true);
  });
});
