import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { BlobNotFoundError, del, get, put } from "@vercel/blob";
import { requireUser } from "../auth/requireUser";
import { DELETE, GET, POST } from "../../app/api/pets/photo/route";
import { POST as COMMIT } from "../../app/api/pets/photo/commit/route";
import { PHOTO_MAX_BYTES, PHOTO_REQUEST_MAX_BYTES, draftKey, photoKey, squareCrop } from "../pets/photo";

vi.mock("@vercel/blob", () => {
  class BlobNotFoundError extends Error {}
  return { put: vi.fn(), get: vi.fn(), del: vi.fn(), BlobNotFoundError };
});
vi.mock("../auth/requireUser", () => ({ requireUser: vi.fn() }));
vi.mock("../ai/dailyQuota", () => ({ reserveAiQuota: vi.fn(async () => true) }));

// 64 x 64 solid PNG generated once for the tests and the QA script.
const PNG_64_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwBfMZKY1iiH8OITBAtzm7PV1wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYBUYZheEzWzwsAAAAASUVORK5CYII=";
const png64 = () => Buffer.from(PNG_64_B64, "base64");

const PET = "pet_abc123";
const req = (method: string, query = "", body?: FormData) =>
  new Request(`https://app.test/api/pets/photo${query}`, { method, body });

function upload(file: File, petId: string = PET): FormData {
  const form = new FormData();
  form.append("petId", petId);
  form.append("file", file);
  return form;
}

const originalToken = process.env.PETS_READ_WRITE_TOKEN;
beforeEach(() => {
  process.env.PETS_READ_WRITE_TOKEN = "pets_test_token";
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({ userId: "user_A", email: "a@example.com" });
  vi.mocked(put).mockResolvedValue({} as never);
  vi.mocked(del).mockResolvedValue(undefined as never);
});

describe("photo store token", () => {
  it("fails with 500 photo_store_unconfigured when PETS_READ_WRITE_TOKEN is missing", async () => {
    delete process.env.PETS_READ_WRITE_TOKEN;
    try {
      const ok = new File([png64()], "x.png", { type: "image/png" });
      const res = await POST(req("POST", "", upload(ok)));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "photo_store_unconfigured" });
      expect(put).not.toHaveBeenCalled();
      expect((await GET(req("GET", `?petId=${PET}`))).status).toBe(500);
      expect((await DELETE(req("DELETE", `?petId=${PET}`))).status).toBe(500);
      expect((await COMMIT(req("POST", "/commit", undefined))).status).toBe(500);
    } finally {
      process.env.PETS_READ_WRITE_TOKEN = originalToken ?? "pets_test_token";
    }
  });

  it("passes the pets token to put, get and del and never the dish token", async () => {
    const ok = new File([png64()], "x.png", { type: "image/png" });
    await POST(req("POST", "?draft=1", upload(ok)));
    expect(vi.mocked(put).mock.calls[0][2]).toMatchObject({ token: "pets_test_token" });
    vi.mocked(get).mockResolvedValue(null);
    await GET(req("GET", `?petId=${PET}`));
    expect(vi.mocked(get).mock.calls[0][1]).toMatchObject({ token: "pets_test_token" });
    await DELETE(req("DELETE", `?petId=${PET}`));
    expect(vi.mocked(del).mock.calls[0][1]).toMatchObject({ token: "pets_test_token" });
  });
});

describe("squareCrop", () => {
  it("centers a landscape crop", () => {
    expect(squareCrop(4032, 3024)).toEqual({ sx: 504, sy: 0, side: 3024 });
  });
  it("centers a portrait crop", () => {
    expect(squareCrop(3024, 4032)).toEqual({ sx: 0, sy: 504, side: 3024 });
  });
  it("keeps a square as is", () => {
    expect(squareCrop(512, 512)).toEqual({ sx: 0, sy: 0, side: 512 });
  });
  it("floors odd leftovers so the crop stays inside the image", () => {
    expect(squareCrop(101, 100)).toEqual({ sx: 0, sy: 0, side: 100 });
    expect(squareCrop(103, 100)).toEqual({ sx: 1, sy: 0, side: 100 });
  });
});

describe("POST /api/pets/photo", () => {
  it("rejects a file over 1.5 MB before storing anything", async () => {
    const big = new File([new Uint8Array(PHOTO_MAX_BYTES + 1)], "big.jpg", { type: "image/jpeg" });
    const res = await POST(req("POST", "?draft=1", upload(big)));
    expect(res.status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects a request whose content-length is over 2 MiB without reading the body", async () => {
    const formData = vi.fn();
    const fake = {
      headers: new Headers({ "content-length": String(3 * 1024 * 1024) }),
      url: `https://app.test/api/pets/photo?draft=1`,
      formData,
    } as unknown as Request;
    expect(3 * 1024 * 1024).toBeGreaterThan(PHOTO_REQUEST_MAX_BYTES);
    const res = await POST(fake);
    expect(res.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects an image wider or taller than 8000 px after metadata, before storing", async () => {
    const wide = await sharp({
      create: { width: 9000, height: 10, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .png()
      .toBuffer();
    const file = new File([wide], "wide.png", { type: "image/png" });
    const res = await POST(req("POST", "?draft=1", upload(file)));
    expect(res.status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects a wrong content type", async () => {
    const gif = new File([png64()], "x.gif", { type: "image/gif" });
    const res = await POST(req("POST", "?draft=1", upload(gif)));
    expect(res.status).toBe(415);
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects a bad pet id", async () => {
    const ok = new File([png64()], "x.png", { type: "image/png" });
    const res = await POST(req("POST", "?draft=1", upload(ok, "../../etc")));
    expect(res.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects bytes that are not an image", async () => {
    const junk = new File([new TextEncoder().encode("not an image at all")], "x.png", { type: "image/png" });
    const res = await POST(req("POST", "?draft=1", upload(junk)));
    expect(res.status).toBe(415);
    expect(put).not.toHaveBeenCalled();
  });

  it("stages a private, owner-scoped JPEG under the DRAFT key only", async () => {
    const ok = new File([png64()], "x.png", { type: "image/png" });
    const res = await POST(req("POST", "?draft=1", upload(ok)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; updatedAt: string };
    expect(body.key).toBe(`pets/user_A/${PET}.draft.jpg`);
    expect(Number.isNaN(Date.parse(body.updatedAt))).toBe(false);

    expect(put).toHaveBeenCalledTimes(1);
    const [key, bytes, options] = vi.mocked(put).mock.calls[0];
    expect(key).toBe(`pets/user_A/${PET}.draft.jpg`);
    expect(options).toMatchObject({
      access: "private",
      contentType: "image/jpeg",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    const buf = bytes as Buffer;
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
  });

  it("returns the auth response when not signed in", async () => {
    vi.mocked(requireUser).mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));
    const ok = new File([png64()], "x.png", { type: "image/png" });
    const res = await POST(req("POST", "?draft=1", upload(ok)));
    expect(res.status).toBe(401);
    expect(put).not.toHaveBeenCalled();
  });
});

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("POST /api/pets/photo/commit", () => {
  it("copies the draft to the final key, then deletes the draft (get -> put -> del)", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    vi.mocked(get).mockResolvedValue({ statusCode: 200, stream: streamOf(bytes), headers: new Headers(), blob: {} } as never);

    const res = await COMMIT(
      new Request("https://app.test/api/pets/photo/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ petId: PET }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string; updatedAt: string };
    expect(body.key).toBe(`pets/user_A/${PET}.jpg`);
    expect(Number.isNaN(Date.parse(body.updatedAt))).toBe(false);

    expect(get).toHaveBeenCalledWith(`pets/user_A/${PET}.draft.jpg`, {
      access: "private",
      token: "pets_test_token",
      useCache: false,
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(vi.mocked(put).mock.calls[0][0]).toBe(`pets/user_A/${PET}.jpg`);
    expect(Buffer.compare(vi.mocked(put).mock.calls[0][1] as Buffer, Buffer.from(bytes))).toBe(0);
    expect(vi.mocked(put).mock.calls[0][2]).toMatchObject({ access: "private", contentType: "image/jpeg", allowOverwrite: true });
    expect(del).toHaveBeenCalledWith(`pets/user_A/${PET}.draft.jpg`, { token: "pets_test_token" });

    const getOrder = vi.mocked(get).mock.invocationCallOrder[0];
    const putOrder = vi.mocked(put).mock.invocationCallOrder[0];
    const delOrder = vi.mocked(del).mock.invocationCallOrder[0];
    expect(getOrder).toBeLessThan(putOrder);
    expect(putOrder).toBeLessThan(delOrder);
  });

  it("404 no_draft and writes nothing when there is no draft to commit", async () => {
    vi.mocked(get).mockResolvedValue(null);
    const res = await COMMIT(
      new Request("https://app.test/api/pets/photo/commit", {
        method: "POST",
        body: JSON.stringify({ petId: PET }),
      }),
    );
    expect(res.status).toBe(404);
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("400 for a bad pet id", async () => {
    const res = await COMMIT(
      new Request("https://app.test/api/pets/photo/commit", { method: "POST", body: JSON.stringify({ petId: "../x" }) }),
    );
    expect(res.status).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("GET /api/pets/photo", () => {
  it("reads origin (useCache false) and returns no-store, for the saved photo", async () => {
    vi.mocked(get).mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream(),
      headers: new Headers(),
      blob: {} as never,
    } as never);
    const res = await GET(req("GET", `?petId=${PET}&v=2026-10-31T10:00:00.000Z`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(get).toHaveBeenCalledWith(`pets/user_A/${PET}.jpg`, { access: "private", token: "pets_test_token", useCache: false });
  });

  it("reads the draft key when draft=1", async () => {
    vi.mocked(get).mockResolvedValue(null);
    await GET(req("GET", `?petId=${PET}&draft=1&v=x`));
    expect(get).toHaveBeenCalledWith(`pets/user_A/${PET}.draft.jpg`, { access: "private", token: "pets_test_token", useCache: false });
  });

  it("404 when the blob is missing (null from the SDK)", async () => {
    vi.mocked(get).mockResolvedValue(null);
    const res = await GET(req("GET", `?petId=${PET}`));
    expect(res.status).toBe(404);
  });

  it("404 when the SDK throws BlobNotFoundError", async () => {
    vi.mocked(get).mockRejectedValue(new BlobNotFoundError());
    const res = await GET(req("GET", `?petId=${PET}`));
    expect(res.status).toBe(404);
  });

  it("never reads a key taken from the query string", async () => {
    vi.mocked(get).mockResolvedValue(null);
    const res = await GET(req("GET", `?petId=${PET}&key=pets/user_B/${PET}.jpg`));
    expect(res.status).toBe(404);
    expect(get).toHaveBeenCalledWith(`pets/user_A/${PET}.jpg`, { access: "private", token: "pets_test_token", useCache: false });
  });
});

describe("DELETE /api/pets/photo", () => {
  it("removes both the saved photo and the draft", async () => {
    const res = await DELETE(req("DELETE", `?petId=${PET}`));
    expect(res.status).toBe(204);
    expect(del).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledWith(`pets/user_A/${PET}.jpg`, { token: "pets_test_token" });
    expect(del).toHaveBeenCalledWith(`pets/user_A/${PET}.draft.jpg`, { token: "pets_test_token" });
  });

  it("with draft=1 removes only the draft (Cancel)", async () => {
    const res = await DELETE(req("DELETE", `?petId=${PET}&draft=1`));
    expect(res.status).toBe(204);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(`pets/user_A/${PET}.draft.jpg`, { token: "pets_test_token" });
  });

  it("a missing blob is not an error", async () => {
    vi.mocked(del).mockRejectedValue(new BlobNotFoundError());
    const res = await DELETE(req("DELETE", `?petId=${PET}`));
    expect(res.status).toBe(204);
  });

  it("another user's request maps to that user's own keys", () => {
    expect(photoKey("user_B", PET)).toBe(`pets/user_B/${PET}.jpg`);
    expect(photoKey("user_B", PET)).not.toBe(photoKey("user_A", PET));
    expect(draftKey("user_B", PET)).toBe(`pets/user_B/${PET}.draft.jpg`);
  });
});
