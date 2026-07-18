import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const run = promisify(execFile);

const SUPABASE_URL = "https://syufjyazsarkkvbebpsb.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_64eQGFVOxzFEn-Ezgj_lQQ_rpMfLZu1";
const HEART_PHOTOS_BUCKET = "heart-photos";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const API_KEY = SERVICE_KEY || SUPABASE_PUBLIC_KEY;
const CAN_FINALIZE = Boolean(SERVICE_KEY);
const DISPLAY_MAX_PIXELS = 2000;
const THUMB_MAX_PIXELS = 900;

async function main() {
  const hearts = await fetchPendingHearts();

  if (!hearts.length) {
    log("No HEIC images are waiting for conversion.");
    return;
  }

  if (!CAN_FINALIZE) {
    log("No SUPABASE_SERVICE_ROLE_KEY found. I can convert and upload, then print the database update to run.");
  }

  for (const heart of hearts) {
    await convertHeart(heart);
  }
}

async function fetchPendingHearts() {
  const query = new URLSearchParams({
    select:
      "id,title,image_original_path,conversion_attempts,conversion_status",
    conversion_status: "eq.pending",
    order: "submitted_at.asc",
  });

  return supabaseJson(`/rest/v1/hearts?${query}`);
}

async function convertHeart(heart) {
  const workDir = await mkdtemp(path.join(tmpdir(), "heart-convert-"));
  const originalPath = path.join(workDir, "original.heic");
  const displayPath = path.join(workDir, `${heart.id}-display.jpg`);
  const thumbnailPath = path.join(workDir, `${heart.id}-thumb.jpg`);
  const displayStoragePath = `display/${heart.id}.jpg`;
  const thumbnailStoragePath = `thumbnails/${heart.id}.jpg`;

  try {
    log(`Converting ${heart.title || heart.id}`);

    if (CAN_FINALIZE) {
      await markProcessing(heart);
    }

    const originalBytes = await downloadPublicObject(heart.image_original_path);
    await writeFile(originalPath, originalBytes);

    await convertWithSips(originalPath, displayPath, DISPLAY_MAX_PIXELS);
    await convertWithSips(originalPath, thumbnailPath, THUMB_MAX_PIXELS);

    await uploadObject(displayStoragePath, await readFile(displayPath));
    await uploadObject(thumbnailStoragePath, await readFile(thumbnailPath));

    if (CAN_FINALIZE) {
      await finalizeHeart(heart.id, displayStoragePath, thumbnailStoragePath);
      log(`Ready: ${heart.id}`);
    } else {
      log("Converted files uploaded. Run this database update to finalize:");
      log(finalizeSql(heart.id, displayStoragePath, thumbnailStoragePath));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (CAN_FINALIZE) {
      await markFailed(heart, message);
    }

    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function convertWithSips(inputPath, outputPath, maxPixels) {
  await run("sips", [
    "-s",
    "format",
    "jpeg",
    "-s",
    "formatOptions",
    "85",
    "-Z",
    String(maxPixels),
    inputPath,
    "--out",
    outputPath,
  ]);
}

async function downloadPublicObject(storagePath) {
  const url = `${SUPABASE_URL}/storage/v1/object/public/${HEART_PHOTOS_BUCKET}/${encodeStoragePath(
    storagePath,
  )}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Could not download original image: ${response.status} ${response.statusText}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function uploadObject(storagePath, bytes) {
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${HEART_PHOTOS_BUCKET}/${encodeStoragePath(storagePath)}`,
    {
      method: "POST",
      headers: {
        apikey: API_KEY,
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "image/jpeg",
        "x-upsert": "false",
        "Cache-Control": "31536000",
      },
      body: bytes,
    },
  );

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 400 && body.includes("already exists")) return;
    throw new Error(`Could not upload ${storagePath}: ${response.status} ${body}`);
  }
}

async function markProcessing(heart) {
  await patchHeart(heart.id, {
    conversion_status: "processing",
    conversion_attempts: Number(heart.conversion_attempts || 0) + 1,
    conversion_error: null,
    conversion_started_at: new Date().toISOString(),
  });
}

async function finalizeHeart(id, displayPath, thumbnailPath) {
  await patchHeart(id, {
    image_display_path: displayPath,
    image_thumbnail_path: thumbnailPath,
    conversion_status: "ready",
    conversion_error: null,
    converted_at: new Date().toISOString(),
  });
}

async function markFailed(heart, message) {
  await patchHeart(heart.id, {
    conversion_status: "failed",
    conversion_attempts: Number(heart.conversion_attempts || 0) + 1,
    conversion_error: message.slice(0, 1000),
  });
}

async function patchHeart(id, values) {
  await supabaseJson(`/rest/v1/hearts?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(values),
  });
}

async function supabaseJson(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: {
      apikey: API_KEY,
      Authorization: `Bearer ${API_KEY}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase request failed: ${response.status} ${body}`);
  }

  if (response.status === 204) return null;

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function finalizeSql(id, displayPath, thumbnailPath) {
  return [
    "update public.hearts",
    "set",
    `  image_display_path = '${escapeSql(displayPath)}',`,
    `  image_thumbnail_path = '${escapeSql(thumbnailPath)}',`,
    "  conversion_status = 'ready'::public.heart_conversion_status,",
    "  conversion_error = null,",
    "  converted_at = now()",
    `where id = '${escapeSql(id)}';`,
  ].join("\n");
}

function encodeStoragePath(storagePath) {
  return storagePath.split("/").map(encodeURIComponent).join("/");
}

function escapeSql(value) {
  return String(value).replaceAll("'", "''");
}

function log(message) {
  console.log(message);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
