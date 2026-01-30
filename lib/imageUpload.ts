import {
  EventTemplate,
  getPublicKey,
  generateSecretKey,
  finalizeEvent,
  VerifiedEvent,
} from "nostr-tools";
import { Signer } from "./signers";

const DEFAULT_SERVER = "https://blossom.nostr.build";

/**
 * Compute SHA-256 hash of a file/blob
 */
async function sha256(data: Blob): Promise<string> {
  const buffer = await data.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create a Blossom upload auth event template (kind 24242)
 * Based on BUD-01: https://github.com/hzrd149/blossom/blob/master/buds/01.md
 */
function createUploadAuthEventTemplate(fileSha256: string): EventTemplate {
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + 300; // 5 minutes

  return {
    kind: 24242,
    created_at: now,
    tags: [
      ["t", "upload"],
      ["x", fileSha256],
      ["expiration", String(expiration)],
    ],
    content: "Upload DM Circle image",
  };
}

/**
 * Create and sign upload auth event with a secret key (for anonymous uploads)
 */
function createUploadAuthEventWithKey(
  secretKey: Uint8Array,
  fileSha256: string,
): VerifiedEvent {
  const eventTemplate = createUploadAuthEventTemplate(fileSha256);
  return finalizeEvent(eventTemplate, secretKey);
}

/**
 * Create and sign upload auth event with a Signer (for authenticated uploads)
 */
async function createUploadAuthEventWithSigner(
  signer: Signer,
  fileSha256: string,
): Promise<VerifiedEvent> {
  const eventTemplate = createUploadAuthEventTemplate(fileSha256);
  return await signer.signEvent(eventTemplate);
}

/**
 * Encode auth event for Authorization header (NIP-98 style)
 */
function encodeAuthorizationHeader(auth: object): string {
  return "Nostr " + btoa(unescape(encodeURIComponent(JSON.stringify(auth))));
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export interface UploadResult {
  url: string;
  sha256: string;
  size: number;
  type: string;
}

export interface UploadOptions {
  blob: Blob;
  filename: string;
  signer?: Signer; // Use for authenticated uploads (user is signed in)
  secretKey?: Uint8Array; // Use for anonymous uploads (fallback to random key if neither provided)
  server?: string;
  onProgress?: (progress: UploadProgress) => void;
}

/**
 * Upload an image blob to Blossom server
 *
 * Supports two modes:
 * 1. Authenticated: Pass a signer from the user's session
 * 2. Anonymous: Pass a secretKey or let it generate a random one
 */
export async function uploadImageToBlossom(
  options: UploadOptions,
): Promise<UploadResult> {
  const {
    blob,
    signer,
    secretKey,
    server = DEFAULT_SERVER,
    onProgress,
  } = options;

  // Compute file hash
  const fileSha = await sha256(blob);

  // Create authorization event
  let auth: VerifiedEvent;
  if (signer) {
    // Use the user's signer for authenticated upload
    auth = await createUploadAuthEventWithSigner(signer, fileSha);
  } else {
    // Use provided key or generate a random one for anonymous upload
    const signingKey = secretKey || generateSecretKey();
    auth = createUploadAuthEventWithKey(signingKey, fileSha);
  }

  // Encode authorization header
  const encodedAuth = encodeAuthorizationHeader(auth);

  // Build URLs - try /media first (BUD-05), fallback to /upload
  const baseUrl = server.endsWith("/") ? server.slice(0, -1) : server;
  const mediaUrl = `${baseUrl}/media`;
  const uploadUrl = `${baseUrl}/upload`;

  // Headers for the upload
  const headers: Record<string, string> = {
    "X-SHA-256": fileSha,
    Authorization: encodedAuth,
    "Content-Type": blob.type || "image/png",
  };

  // Try /media endpoint first (strips EXIF)
  let targetUrl = mediaUrl;
  try {
    const headResponse = await fetch(mediaUrl, {
      method: "HEAD",
      headers: {
        ...headers,
        "X-Content-Length": String(blob.size),
        "X-Content-Type": blob.type || "image/png",
      },
    });
    if (headResponse.status !== 200) {
      targetUrl = uploadUrl;
    }
  } catch {
    targetUrl = uploadUrl;
  }

  // Upload with XHR for progress support
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percent: Math.round((e.loaded / e.total) * 100),
        });
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve({
            url: response.url,
            sha256: response.sha256 || fileSha,
            size: response.size || blob.size,
            type: response.type || blob.type,
          });
        } catch {
          reject(new Error("Invalid response from server"));
        }
      } else {
        reject(
          new Error(`Upload failed: ${xhr.statusText || "Unknown error"}`),
        );
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Upload failed: Network error"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload cancelled"));
    });

    xhr.open("PUT", targetUrl, true);

    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }

    xhr.send(blob);
  });
}

/**
 * Convert canvas to blob
 */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality = 0.95,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to convert canvas to blob"));
        }
      },
      type,
      quality,
    );
  });
}
