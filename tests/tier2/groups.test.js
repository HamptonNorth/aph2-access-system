// CRUD for groups, plus the FK-protected delete.

import { describe, it, expect } from "bun:test";
import { loginAs } from "./setup.js";

describe("groups CRUD", () => {
  it("listing returns the seeded groups", async () => {
    const a = await loginAs("admin", "adminpw");
    const res = await a.get("/api/groups");
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.groups.map((g) => g.name);
    expect(names).toContain("Trustees");
    expect(names).toContain("Volunteers");
  });

  it("user_count is the live count of active users in the group", async () => {
    // Order-independent: create a fresh group + a fresh user belonging only
    // to it, so the count is exactly 1 regardless of what other suites did.
    const a = await loginAs("admin", "adminpw");
    const made = await a.post("/api/groups", { name: "Yoga" });
    const groupId = (await made.json()).group.id;

    await a.post("/api/users", {
      first_name: "Yogi",
      surname:    "Bear",
      fob_number: "0000099001",
      group_id:   groupId,
    });

    const res = await a.get("/api/groups");
    const found = (await res.json()).groups.find((g) => g.id === groupId);
    expect(found.user_count).toBe(1);
  });

  it("create requires a name", async () => {
    const a = await loginAs("admin", "adminpw");
    const res = await a.post("/api/groups", {});
    expect(res.status).toBe(400);
  });

  it("create returns 201 and 409 on duplicate name", async () => {
    const a = await loginAs("admin", "adminpw");
    const ok = await a.post("/api/groups", { name: "Friends", description: "Friends of the Hall" });
    expect(ok.status).toBe(201);

    const dup = await a.post("/api/groups", { name: "Friends" });
    expect(dup.status).toBe(409);
  });

  it("update changes the description", async () => {
    const a = await loginAs("admin", "adminpw");
    const made = await a.post("/api/groups", { name: "Cubs" });
    const id = (await made.json()).group.id;

    const res = await a.put(`/api/groups/${id}`, { description: "Cub Scouts pack" });
    expect(res.status).toBe(200);
    expect((await res.json()).group.description).toBe("Cub Scouts pack");
  });

  it("delete fails 409 if users still belong to the group", async () => {
    const a = await loginAs("admin", "adminpw");
    const res = await a.delete("/api/groups/1");   // Trustees has Alice
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("has_users");
  });

  it("delete succeeds for an empty group", async () => {
    const a = await loginAs("admin", "adminpw");
    const made = await a.post("/api/groups", { name: "Empty" });
    const id = (await made.json()).group.id;
    const res = await a.delete(`/api/groups/${id}`);
    expect(res.status).toBe(200);
  });
});
