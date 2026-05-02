// CRUD + block/unblock + soft delete + controller-sync queue writes.

import { describe, it, expect } from "bun:test";

import { loginAs, newAgent } from "./setup.js";
import db from "../../server/db.js";

function pendingQueueOpsForFob(fob) {
  return db.query(
    `SELECT action FROM controller_sync_queue WHERE fob_number = $f ORDER BY id`
  ).all({ $f: fob }).map((r) => r.action);
}

// Convenience: the standard payload shape for a new door user.
function userPayload(first, surname, fob, group_id) {
  const out = { first_name: first, surname, fob_number: fob };
  if (group_id != null) out.group_id = group_id;
  return out;
}

describe("users CRUD", () => {
  it("anon can't list", async () => {
    const a = newAgent();
    const res = await a.get("/api/users");
    expect(res.status).toBe(401);
  });

  it("usermgr can list active users only by default", async () => {
    const a = await loginAs("usermgr", "usermgrpw");
    const res = await a.get("/api/users");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users.map((u) => u.name).sort()).toEqual(["Alice Allowed", "Bob Blocked"]);
  });

  it("create requires first_name, surname and fob", async () => {
    const a = await loginAs("admin", "adminpw");

    const noFirst = await a.post("/api/users", { surname: "X", fob_number: "0000003001" });
    expect(noFirst.status).toBe(400);

    const noSurname = await a.post("/api/users", { first_name: "X", fob_number: "0000003001" });
    expect(noSurname.status).toBe(400);

    const noFob = await a.post("/api/users", { first_name: "X", surname: "Y" });
    expect(noFob.status).toBe(400);
  });

  it("create assigns a row and enqueues 'set' to controller-sync", async () => {
    const a = await loginAs("admin", "adminpw");
    const res = await a.post("/api/users", userPayload("Carol", "Created", "0000003001", 1));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.first_name).toBe("Carol");
    expect(body.user.surname).toBe("Created");
    expect(body.user.name).toBe("Carol Created");
    expect(body.user.fob_number).toBe("0000003001");
    expect(pendingQueueOpsForFob("0000003001")).toEqual(["set"]);
  });

  it("rejects duplicate fob_number with 409", async () => {
    const a = await loginAs("admin", "adminpw");
    await a.post("/api/users", userPayload("First", "P1", "0000003101"));
    const dup = await a.post("/api/users", userPayload("First", "P2", "0000003101"));
    expect(dup.status).toBe(409);
  });

  it("amend changes the fob and enqueues delete-old + set-new", async () => {
    const a = await loginAs("admin", "adminpw");
    const made = await a.post("/api/users", userPayload("Pat", "Patel", "0000003201"));
    const id = (await made.json()).user.id;

    const upd = await a.put(`/api/users/${id}`, { fob_number: "0000003202" });
    expect(upd.status).toBe(200);
    expect((await upd.json()).user.fob_number).toBe("0000003202");

    expect(pendingQueueOpsForFob("0000003201")).toEqual(["set", "delete"]);
    expect(pendingQueueOpsForFob("0000003202")).toEqual(["set"]);
  });

  it("amend can change first_name / surname; rejects clearing them", async () => {
    const a = await loginAs("admin", "adminpw");
    const made = await a.post("/api/users", userPayload("Rena", "Mable", "0000003205"));
    const id = (await made.json()).user.id;

    const ok = await a.put(`/api/users/${id}`, { first_name: "Renamed" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).user.first_name).toBe("Renamed");

    const clear = await a.put(`/api/users/${id}`, { surname: "" });
    expect(clear.status).toBe(400);
  });

  it("block requires a reason and enqueues a delete to the controller", async () => {
    const a = await loginAs("admin", "adminpw");
    const made = await a.post("/api/users", userPayload("Bo", "Blockee", "0000003301"));
    const id = (await made.json()).user.id;

    const noReason = await a.post(`/api/users/${id}/block`, {});
    expect(noReason.status).toBe(400);

    const blocked = await a.post(`/api/users/${id}/block`, { reason: "unpaid" });
    expect(blocked.status).toBe(200);
    const body = await blocked.json();
    expect(body.user.blocked).toBe(1);
    expect(body.user.blocked_reason).toBe("unpaid");
    // 'set' from create + 'delete' from block.
    expect(pendingQueueOpsForFob("0000003301")).toEqual(["set", "delete"]);
  });

  it("unblock re-enqueues a set", async () => {
    const a = await loginAs("admin", "adminpw");
    const made = await a.post("/api/users", userPayload("Unblock", "Me", "0000003401"));
    const id = (await made.json()).user.id;
    await a.post(`/api/users/${id}/block`, { reason: "test" });
    const res = await a.post(`/api/users/${id}/unblock`, {});
    expect(res.status).toBe(200);
    expect((await res.json()).user.blocked).toBe(0);
    expect(pendingQueueOpsForFob("0000003401")).toEqual(["set", "delete", "set"]);
  });

  it("soft-delete sets deleted_at, nulls fob_number, enqueues delete", async () => {
    const a = await loginAs("admin", "adminpw");
    const made = await a.post("/api/users", userPayload("Soft", "Delete", "0000003501"));
    const id = (await made.json()).user.id;

    const del = await a.delete(`/api/users/${id}`);
    expect(del.status).toBe(200);

    // Default list excludes soft-deleted users.
    const list = await a.get("/api/users");
    const found = (await list.json()).users.find((u) => u.id === id);
    expect(found).toBeUndefined();

    // include_deleted=1 shows them with fob nulled.
    const all = await a.get("/api/users?include_deleted=1");
    const seen = (await all.json()).users.find((u) => u.id === id);
    expect(seen.deleted_at).not.toBeNull();
    expect(seen.fob_number).toBeNull();

    expect(pendingQueueOpsForFob("0000003501")).toEqual(["set", "delete"]);
  });

  it("after soft-delete, the same fob can be reissued to a new user", async () => {
    const a = await loginAs("admin", "adminpw");
    const made = await a.post("/api/users", userPayload("Original", "User", "0000003601"));
    const id = (await made.json()).user.id;
    await a.delete(`/api/users/${id}`);

    const reissue = await a.post("/api/users", userPayload("Reissued", "User", "0000003601"));
    expect(reissue.status).toBe(201);
    expect((await reissue.json()).user.fob_number).toBe("0000003601");
  });

  it("amend rejects an attempt to clear fob_number (use delete instead)", async () => {
    const a = await loginAs("admin", "adminpw");
    const made = await a.post("/api/users", userPayload("Keep", "Fob", "0000003701"));
    const id = (await made.json()).user.id;

    const res = await a.put(`/api/users/${id}`, { fob_number: "" });
    expect(res.status).toBe(400);
  });

  it("operations on a soft-deleted user return 410", async () => {
    const a = await loginAs("admin", "adminpw");
    const made = await a.post("/api/users", userPayload("Gone", "Forever", "0000003801"));
    const id = (await made.json()).user.id;
    await a.delete(`/api/users/${id}`);

    expect((await a.put(`/api/users/${id}`, { first_name: "x" })).status).toBe(410);
    expect((await a.post(`/api/users/${id}/block`, { reason: "x" })).status).toBe(410);
    expect((await a.post(`/api/users/${id}/unblock`, {})).status).toBe(410);
    expect((await a.delete(`/api/users/${id}`)).status).toBe(410);
  });
});
