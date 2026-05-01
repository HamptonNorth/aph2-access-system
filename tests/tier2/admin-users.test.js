// CRUD + role guards + audit-log writes for admin-users.

import { describe, it, expect } from "bun:test";

import { loginAs } from "./setup.js";
import db from "../../server/db.js";

function auditCount(table, rowId) {
  return db.query(
    `SELECT COUNT(*) AS n FROM audit_log WHERE table_name = $t AND row_id = $id`
  ).get({ $t: table, $id: rowId }).n;
}

describe("admin-users CRUD", () => {
  it("non super-user can't list admins", async () => {
    const a = await loginAs("usermgr", "usermgrpw");
    const res = await a.get("/api/admin-users");
    expect(res.status).toBe(403);
  });

  it("super user can list admins", async () => {
    const a = await loginAs("admin", "adminpw");
    const res = await a.get("/api/admin-users");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.admin_users.length).toBeGreaterThanOrEqual(2);
  });

  it("creates a new admin and audits it", async () => {
    const a = await loginAs("admin", "adminpw");
    const res = await a.post("/api/admin-users", {
      username: "alice@example.com",
      fob_number: "0000000099",
      manage_groups: 1,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.admin_user.username).toBe("alice@example.com");
    expect(body.admin_user.manage_groups).toBe(1);
    expect(body.admin_user.has_password).toBe(0);

    expect(auditCount("admin_users", body.admin_user.id)).toBe(1);
  });

  it("updates flags and writes a second audit row", async () => {
    const a = await loginAs("admin", "adminpw");
    const created = await a.post("/api/admin-users", { username: "bob@example.com" });
    const id = (await created.json()).admin_user.id;

    const res = await a.put(`/api/admin-users/${id}`, { view_reports: 1 });
    expect(res.status).toBe(200);
    expect((await res.json()).admin_user.view_reports).toBe(1);
    expect(auditCount("admin_users", id)).toBe(2);
  });

  it("set password lets the new admin sign in", async () => {
    const a = await loginAs("admin", "adminpw");
    const created = await a.post("/api/admin-users", { username: "carol@example.com" });
    const id = (await created.json()).admin_user.id;

    const setpw = await a.put(`/api/admin-users/${id}/password`, { password: "carolpw" });
    expect(setpw.status).toBe(200);

    const carol = await loginAs("carol@example.com", "carolpw");
    const me = await carol.get("/api/auth/me");
    expect((await me.json()).admin.id).toBe(id);
  });

  it("self can read own profile but not others'", async () => {
    const a = await loginAs("usermgr", "usermgrpw");
    const self = await a.get("/api/admin-users/2");   // usermgr is id=2
    expect(self.status).toBe(200);

    const other = await a.get("/api/admin-users/1"); // admin is id=1
    expect(other.status).toBe(403);
  });

  it("super_user can't delete themselves", async () => {
    const a = await loginAs("admin", "adminpw");
    const res = await a.delete("/api/admin-users/1");
    expect(res.status).toBe(400);
  });

  it("hard-delete fails with 409 if there is audit history; deactivate succeeds", async () => {
    const a = await loginAs("admin", "adminpw");
    const created = await a.post("/api/admin-users", { username: "dave@example.com" });
    const id = (await created.json()).admin_user.id;

    // We need an audit_log row whose admin_user_id IS Dave, so that deleting
    // Dave fires the FK guard. Have Dave perform a self-action: set their
    // own password (which writes an audit row authored by Dave).
    await a.put(`/api/admin-users/${id}/password`, { password: "davepw1" });
    const dave = await loginAs("dave@example.com", "davepw1");
    const selfReset = await dave.put(`/api/admin-users/${id}/password`, { password: "davepw2" });
    expect(selfReset.status).toBe(200);

    // Now back to super_user, and try to delete Dave - should 409.
    const del = await a.delete(`/api/admin-users/${id}`);
    expect(del.status).toBe(409);
    expect((await del.json()).code).toBe("has_history");

    const deact = await a.post(`/api/admin-users/${id}/deactivate`);
    expect(deact.status).toBe(200);
    const body = await deact.json();
    expect(body.admin_user.manage_users).toBe(0);
    expect(body.admin_user.has_password).toBe(0);
  });
});
