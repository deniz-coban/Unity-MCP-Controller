import { unityConfig } from "../config.js";
import type {
  ModelFileExtension,
  OnlineModelCandidate
} from "../types.js";

interface PolyPizzaDownloadUrl {
  url: string;
  Format?: string;
  format?: string;
  extension?: string;
}

interface PolyPizzaResult {
  ID?: string;
  id?: string;
  Title?: string;
  title?: string;
  Author?: { Name?: string; Username?: string } | string;
  Attribution?: string;
  License?: string;
  Thumbnail?: string;
  thumbnail?: string;
  Link?: string;
  link?: string;
  Download?: string | PolyPizzaDownloadUrl;
  Downloads?:
    | Record<string, PolyPizzaDownloadUrl | string>
    | PolyPizzaDownloadUrl[];
}

interface PolyPizzaSearchResponse {
  total?: number;
  results?: PolyPizzaResult[];
}

const SEARCH_TIMEOUT_MS = 15000;

const tryParseDirectExtension = (
  url: string
): ModelFileExtension | undefined => {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".obj")) return ".obj";
  if (lower.endsWith(".glb")) return ".glb";
  if (lower.endsWith(".gltf")) return ".gltf";
  if (lower.endsWith(".fbx")) return ".fbx";
  return undefined;
};

const extractDownloadCandidates = (
  result: PolyPizzaResult
): Array<{ url: string; extension: ModelFileExtension }> => {
  const out: Array<{ url: string; extension: ModelFileExtension }> = [];

  const consume = (raw: PolyPizzaDownloadUrl | string | undefined) => {
    if (!raw) return;
    if (typeof raw === "string") {
      const ext = tryParseDirectExtension(raw);
      if (ext) {
        out.push({ url: raw, extension: ext });
      }
      return;
    }
    const url = raw.url;
    if (!url) return;
    const explicitFormat = (raw.Format ?? raw.format ?? raw.extension ?? "")
      .toString()
      .toLowerCase()
      .replace(/^\./, "");
    let ext: ModelFileExtension | undefined;
    if (explicitFormat === "obj") ext = ".obj";
    else if (explicitFormat === "glb") ext = ".glb";
    else if (explicitFormat === "gltf") ext = ".gltf";
    else if (explicitFormat === "fbx") ext = ".fbx";
    if (!ext) {
      ext = tryParseDirectExtension(url);
    }
    if (ext) {
      out.push({ url, extension: ext });
    }
  };

  consume(result.Download);

  if (Array.isArray(result.Downloads)) {
    for (const item of result.Downloads) consume(item);
  } else if (result.Downloads && typeof result.Downloads === "object") {
    for (const value of Object.values(result.Downloads)) consume(value);
  }

  // Prefer OBJ then GLB then GLTF then FBX.
  const order: ModelFileExtension[] = [".obj", ".glb", ".gltf", ".fbx"];
  out.sort(
    (a, b) => order.indexOf(a.extension) - order.indexOf(b.extension)
  );

  return out;
};

const authorName = (result: PolyPizzaResult): string => {
  const author = result.Author;
  if (!author) return "Unknown";
  if (typeof author === "string") return author;
  return author.Name ?? author.Username ?? "Unknown";
};

export const isPolyPizzaConfigured = (): boolean =>
  Boolean(unityConfig.onlineModels.polyPizzaApiKey);

export const searchPolyPizza = async (
  query: string,
  limit = 5
): Promise<OnlineModelCandidate[]> => {
  if (!isPolyPizzaConfigured()) {
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const url = `https://api.poly.pizza/v1.1/search/${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-auth-token": unityConfig.onlineModels.polyPizzaApiKey!,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `Poly Pizza search failed with status ${response.status}.`
      );
    }

    const data = (await response.json()) as PolyPizzaSearchResponse;
    const results = data.results ?? [];
    const candidates: OnlineModelCandidate[] = [];

    for (const result of results) {
      const downloads = extractDownloadCandidates(result);
      const top = downloads[0];
      if (!top) continue;

      const id = String(result.ID ?? result.id ?? top.url);
      const title = String(result.Title ?? result.title ?? "Untitled model");
      candidates.push({
        id: `poly_pizza:${id}`,
        source: "poly_pizza",
        title,
        author: authorName(result),
        license: String(result.License ?? result.Attribution ?? "Unknown license"),
        thumbnailUrl: result.Thumbnail ?? result.thumbnail,
        sourceUrl: String(result.Link ?? result.link ?? "https://poly.pizza/"),
        downloadRef: {
          kind: "direct",
          url: top.url,
          extension: top.extension
        }
      });
      if (candidates.length >= limit) break;
    }

    return candidates;
  } finally {
    clearTimeout(timer);
  }
};
