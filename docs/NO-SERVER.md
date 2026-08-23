# Why jojo ships no server

A local helper process was designed, built and deleted. This is what was measured
on the way, because the measurements outlived the plan and the next person to
propose a server deserves them.

**The outcome: documents live in IndexedDB.** `web/src/kg/storage/idb-file-store.ts`
implements the same `FileStore` port as the other adapters, so it runs the shared
conformance suite — in Vitest, on every gate, rather than needing a browser.
Measured in Brave: a 2.00 GB quota, a 5 MB file written in 15 ms and read back in
under 1 ms, bytes identical. A job search's tailored documents are a few hundred
kilobytes each.

---

## 1. What forced the shape of this

Three things were measured before any of it was designed, because each one
rules out an architecture that otherwise looks obvious.

### 1.1 Brave has no picker, and feature-detection is a trap

Chrome 151, Edge 151, Brave 151, on the same machine, same secure origin:

| browser | `showDirectoryPicker` | OPFS | `navigator.locks` |
| --- | --- | --- | --- |
| Chrome | yes | yes | yes |
| Edge | yes | yes | yes |
| **Brave** | **no** | yes | yes |

Brave strips the three pickers (`showDirectoryPicker`, `showOpenFilePicker`,
`showSaveFilePicker`) while **keeping** `FileSystemDirectoryHandle`, its
`queryPermission`, and the origin-private filesystem — OPFS is built on the same
types and Brave has no objection to those. So `'FileSystemDirectoryHandle' in
globalThis` answers **true** on a browser that cannot pick a folder at all.
`folderSupported()` tests `showDirectoryPicker` for that reason and must keep
doing so.

### 1.2 A deployed HTTPS page cannot reach `http://127.0.0.1`

From `https://example.com`, fetching `http://127.0.0.1:7423`:

```
corsError: "LocalNetworkAccessPermissionDenied"
```

This is Chrome's **Local Network Access** gate, the successor to Private Network
Access. The old `Access-Control-Allow-Private-Network: true` response header does
not satisfy it — it became a user permission, not a header negotiation. Setting
the header changed nothing.

Causation confirmed rather than inferred: the identical request **succeeds**
under `--disable-features=LocalNetworkAccessChecks` and fails without it.
`Browser.grantPermissions(['localNetworkAccess'])` over CDP was accepted and did
not unblock it, so this cannot be verified headlessly at all.

### 1.3 A localhost page reaches it freely

From `http://127.0.0.1:4300`, the same fetch to `http://127.0.0.1:7423`
**succeeds** — no prompt, no preflight trouble, nothing.

**Therefore: the bridge serves the web app itself.** Same origin end to end. No
CORS, no Local Network Access prompt, no mixed content, and no dependence on a
browser gate that is actively changing between Chrome releases.

---

---

## 2. What was built, and why it was thrown away

A Go server, ~1,580 lines: loopback-only HTTP, a per-run session token delivered
in a URL fragment so `curl /` could not harvest it, Host validation against DNS
rebinding, path confinement with 23 adversarial tests, and five cross-compiled
binaries verified as real ELF, PE32+ and Mach-O.

It worked. It was deleted anyway, because it solved a problem that turned out not
to exist: the documents only ever needed to survive a reload and be previewable
and downloadable, and IndexedDB does all three in every browser jojo runs in.
A server would have added a download, an unsigned-binary warning on two operating
systems, a permission model, and an attack surface reachable by every process on
the machine — to reach parity with a database already in the page.

## 3. If a server is ever proposed again

Read §1.2 first. A deployed HTTPS page **cannot** reach `http://127.0.0.1` in
Chromium 151 — that is not a CORS header away, it is a user permission, and the
only architecture that avoids it is one where the server also serves the app,
which means a second origin and therefore a second IndexedDB and therefore a
migration for every existing user. That cost is what killed it, not the code.
