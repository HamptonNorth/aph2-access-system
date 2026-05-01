// Login / logout / me, plus the basic 401 paths.

import { describe, it, expect } from "bun:test";

import { loginAs, newAgent } from "./setup.js";

describe("auth", () => {
  it("rejects requests without a session cookie", async () => {
    const agent = newAgent();
    const res = await agent.get("/api/admin-users");
    expect(res.status).toBe(401);
  });

  it("login returns 401 for unknown user", async () => {
    const agent = newAgent();
    const res = await agent.post("/api/auth/login", { username: "nope", password: "x" });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/invalid credentials/);
  });

  it("login returns 401 for wrong password (same shape as unknown user)", async () => {
    const agent = newAgent();
    const res = await agent.post("/api/auth/login", { username: "admin", password: "wrong" });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/invalid credentials/);
  });

  it("login returns 400 when fields are missing", async () => {
    const agent = newAgent();
    const res = await agent.post("/api/auth/login", { username: "admin" });
    expect(res.status).toBe(400);
  });

  it("login sets the cookie and returns the admin profile", async () => {
    const agent = newAgent();
    const res = await agent.post("/api/auth/login", { username: "admin", password: "adminpw" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.admin.username).toBe("admin");
    expect(body.admin.super_user).toBe(1);
    expect(agent.cookie).toMatch(/^aph_sid=/);
  });

  it("me returns the signed-in admin", async () => {
    const a = await loginAs("admin", "adminpw");
    const res = await a.get("/api/auth/me");
    expect(res.status).toBe(200);
    expect((await res.json()).admin.username).toBe("admin");
  });

  it("logout clears the session", async () => {
    const a = await loginAs("admin", "adminpw");
    const out = await a.post("/api/auth/logout");
    expect(out.status).toBe(200);
    // Cookie was overwritten with an expired one; ensuing /me should 401.
    const me = await a.get("/api/auth/me");
    expect(me.status).toBe(401);
  });
});
