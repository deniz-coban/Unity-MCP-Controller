import { unityConfig } from "../config.js";
import type { OnlineModelCandidate } from "../types.js";

interface SketchfabUser {
  username?: string;
  displayName?: string;
}

interface SketchfabImage {
  url?: string;
}

interface SketchfabThumbnails {
  images?: SketchfabImage[];
}

interface SketchfabLicense {
  slug?: string;
  label?: string;
  fullName?: string;
}

interface SketchfabResult {
  uid?: string;
  name?: string;
  user?: SketchfabUser;
  thumbnails?: SketchfabThumbnails;
  viewerUrl?: string;
  isDownloadable?: boolean;
  license?: SketchfabLicense | null;
}

interface SketchfabSearchResponse {
  results?: SketchfabResult[];
}

interface SketchfabDownloadFormat {
  url?: string;
  expires?: number;
  size?: number;
}

interface SketchfabDownloadResponse {
  glb?: SketchfabDownloadFormat;
  gltf?: SketchfabDownloadFormat;
  source?: SketchfabDownloadFormat;
  usdz?: SketchfabDownloadFormat;
}

const SEARCH_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 15000;

const bestThumbnail = (result: SketchfabResult): string | undefined => {
  const images = result.thumbnails?.images;
  if (!Array.isArray(images) || images.length === 0) return undefined;
  const withUrl = images.filter((img) => typeof img.url === "string");
  return withUrl[Math.min(1, withUrl.length - 1)]?.url ?? withUrl[0]?.url;
};

const licenseLabel = (result: SketchfabResult): string => {
  const license = result.license;
  if (!license) return "Unknown license";
  return license.label ?? license.fullName ?? license.slug ?? "Unknown license";
};

const authorLabel = (result: SketchfabResult): string => {
  const u = result.user;
  if (!u) return "Unknown";
  return u.displayName ?? u.username ?? "Unknown";
};

export const isSketchfabConfigured = (): boolean =>
  Boolean(unityConfig.onlineModels.sketchfabApiToken);

export const searchSketchfab = async (
  query: string,
  limit = 5
): Promise<OnlineModelCandidate[]> => {
  if (!isSketchfabConfigured()) {
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      type: "models",
      q: query,
      downloadable: "true",
      count: String(Math.max(limit, 5))
    });
    const url = `https://api.sketchfab.com/v3/search?${params.toString()}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Token ${unityConfig.onlineModels.sketchfabApiToken}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `Sketchfab search failed with status ${response.status}.`
      );
    }

    const data = (await response.json()) as SketchfabSearchResponse;
    const results = data.results ?? [];
    const candidates: OnlineModelCandidate[] = [];

    for (const result of results) {
      if (!result.uid || result.isDownloadable === false) continue;
      candidates.push({
        id: `sketchfab:${result.uid}`,
        source: "sketchfab",
        title: result.name ?? "Untitled model",
        author: authorLabel(result),
        license: licenseLabel(result),
        thumbnailUrl: bestThumbnail(result),
        sourceUrl: result.viewerUrl ?? `https://sketchfab.com/3d-models/${result.uid}`,
        downloadRef: {
          kind: "sketchfab-gltf",
          uid: result.uid
        }
      });
      if (candidates.length >= limit) break;
    }

    return candidates;
  } finally {
    clearTimeout(timer);
  }
};

export const fetchSketchfabDownloadUrl = async (
  uid: string
): Promise<{ url: string; preferGlb: boolean }> => {
  if (!isSketchfabConfigured()) {
    throw new Error("Sketchfab is not configured on the backend.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://api.sketchfab.com/v3/models/${encodeURIComponent(uid)}/download`,
      {
        headers: {
          Authorization: `Token ${unityConfig.onlineModels.sketchfabApiToken}`,
          Accept: "application/json"
        },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(
        `Sketchfab download URL request failed (${response.status}).`
      );
    }

    const data = (await response.json()) as SketchfabDownloadResponse;
    if (data.glb?.url) {
      return { url: data.glb.url, preferGlb: true };
    }
    if (data.gltf?.url) {
      return { url: data.gltf.url, preferGlb: false };
    }
    throw new Error("Sketchfab did not return a glb or gltf download URL.");
  } finally {
    clearTimeout(timer);
  }
};
