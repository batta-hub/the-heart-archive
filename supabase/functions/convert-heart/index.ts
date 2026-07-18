import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const HEART_PHOTOS_BUCKET = "heart-photos";
const DEFAULT_CATEGORY_NAME = "Other";
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  let stage = "starting submission";

  try {
    stage = "connecting to Supabase";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase service credentials are missing.");
    }

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
    );

    stage = "checking sign in";
    const user = await requireAuthenticatedUser(supabase, request);

    stage = "reading submitted photo";
    const formData = await request.formData();
    const file = formData.get("image");

    if (!(file instanceof File)) {
      return jsonResponse({ error: "A photo is required." }, 400);
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonResponse(
        { error: "That photo is too large. Please choose one under 15MB." },
        400,
      );
    }

    const locationLabel = cleanRequiredText(formData.get("location"), 80);
    if (!locationLabel) {
      return jsonResponse({ error: "Please add where you found this heart." }, 400);
    }

    const id = crypto.randomUUID();
    const originalExtension = extensionForFile(file);
    const originalPath = `originals/${id}.${originalExtension}`;
    const canDisplayOriginal = isBrowserDisplayable(originalExtension, file.type);
    const originalContentType = contentTypeForFile(file);
    const displayPath = canDisplayOriginal ? originalPath : null;
    const conversionStatus = canDisplayOriginal ? "not_needed" : "pending";

    stage = "saving original photo";
    const originalBytes = new Uint8Array(await file.arrayBuffer());
    await uploadFile(supabase, originalPath, originalBytes, originalContentType);

    stage = "finding default category";
    const categoryId = await getDefaultCategoryId(supabase);

    stage = "creating review row";
    const { error: insertError } = await supabase.from("hearts").insert({
      title: cleanOptionalText(formData.get("title"), 80),
      note: cleanOptionalText(formData.get("note"), 240),
      category_id: categoryId,
      location_label: locationLabel,
      location_visibility: normalizeVisibility(formData.get("visibility")),
      image_original_path: originalPath,
      image_display_path: displayPath,
      image_thumbnail_path: displayPath,
      image_original_mime_type: originalContentType,
      image_original_size_bytes: file.size,
      submitter_id: user.id,
      conversion_status: conversionStatus,
      conversion_requested_at: canDisplayOriginal ? null : new Date().toISOString(),
    });

    if (insertError) {
      throw insertError;
    }

    return jsonResponse({
      id,
      image_original_path: originalPath,
      image_display_path: displayPath,
      image_thumbnail_path: displayPath,
      needs_conversion: !canDisplayOriginal,
      status: "pending",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ stage, message }));
    if (error instanceof AuthError) {
      return jsonResponse({ error: error.message }, 401);
    }
    return jsonResponse(
      {
        error: errorMessageForStage(stage),
        stage,
      },
      500,
    );
  }
});

class AuthError extends Error {}

async function requireAuthenticatedUser(
  supabase: ReturnType<typeof createClient>,
  request: Request,
) {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    throw new AuthError("Please sign in to share a heart.");
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new AuthError("Please sign in again before sharing a heart.");
  }

  return data.user;
}

async function uploadFile(
  supabase: ReturnType<typeof createClient>,
  path: string,
  bytes: Uint8Array,
  contentType: string,
) {
  const { error } = await supabase.storage
    .from(HEART_PHOTOS_BUCKET)
    .upload(path, bytes, {
      contentType,
      cacheControl: "31536000",
      upsert: false,
    });

  if (error) {
    throw error;
  }
}

async function getDefaultCategoryId(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from("categories")
    .select("id")
    .eq("name", DEFAULT_CATEGORY_NAME)
    .single();

  if (error || !data?.id) {
    throw error ?? new Error("Default category not found.");
  }

  return data.id;
}

function cleanOptionalText(value: FormDataEntryValue | null, maxLength: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().slice(0, maxLength);
  return cleaned || null;
}

function cleanRequiredText(value: FormDataEntryValue | null, maxLength: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().slice(0, maxLength);
  return cleaned || null;
}

function normalizeVisibility(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "hidden";
  const normalized = value.trim().toLowerCase();
  if (["hidden", "approximate", "public"].includes(normalized)) {
    return normalized;
  }
  return "hidden";
}

function extensionForFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const cleanExtension = extension.replace(/[^a-z0-9]/g, "");

  if (cleanExtension) return cleanExtension;
  if (file.type === "image/heic") return "heic";
  if (file.type === "image/heif") return "heif";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function contentTypeForFile(file: File) {
  if (file.type) return file.type;

  const extension = extensionForFile(file);
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "image/jpeg";
}

function isBrowserDisplayable(extension: string, contentType: string) {
  return (
    ["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(extension) ||
    ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(
      contentType,
    )
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Connection": "keep-alive",
    },
  });
}

function errorMessageForStage(stage: string) {
  if (stage === "saving original photo") {
    return "Supabase storage rejected the photo upload.";
  }

  if (stage === "creating review row") {
    return "The photo was saved, but the review row could not be created.";
  }

  return "We could not submit this photo. Please try again in a moment.";
}
