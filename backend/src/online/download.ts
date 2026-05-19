import AdmZip from "adm-zip";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ModelFileExtension,
  OnlineModelCandidate
} from "../types.js";
import { fetchSketchfabDownloadUrl } from "./sketchfab.js";

const DOWNLOAD_TIMEOUT_MS = 60000;
const TEMP_ROOT = path.join(os.tmpdir(), "scene-builder-online-models");

export interface DownloadedModelFile {
  absolutePath: string;
  originalName: string;
  extension: ModelFileExtension;
  sizeBytes: number;
}

const sanitizeName = (input: string): string =>
  input
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+/, "")
    .slice(0, 80) || "model";

const fetchBinary = async (
  url: string,
  timeoutMs = DOWNLOAD_TIMEOUT_MS
): Promise<Buffer> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow"
    });
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}.`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer;
  } finally {
    clearTimeout(timer);
  }
};

const extractGltfFromZip = (
  zipBuffer: Buffer
): { fileName: string; extension: ModelFileExtension; data: Buffer } => {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);

  // Prefer a single .glb if present (self-contained).
  const glb = entries.find((e) =>
    e.entryName.toLowerCase().endsWith(".glb")
  );
  if (glb) {
    return {
      fileName: path.basename(glb.entryName),
      extension: ".glb",
      data: glb.getData()
    };
  }

  // Otherwise pick the top-level scene.gltf or any .gltf.
  const gltf =
    entries.find((e) =>
      e.entryName.toLowerCase().endsWith("scene.gltf")
    ) ??
    entries.find((e) => e.entryName.toLowerCase().endsWith(".gltf"));

  if (!gltf) {
    throw new Error("Zip archive did not contain a .glb or .gltf file.");
  }

  return {
    fileName: path.basename(gltf.entryName),
    extension: ".gltf",
    data: gltf.getData()
  };
};

export const downloadCandidateToTemp = async (
  candidate: OnlineModelCandidate
): Promise<DownloadedModelFile> => {
  await fs.mkdir(TEMP_ROOT, { recursive: true });
  const baseName = sanitizeName(candidate.title);

  if (candidate.downloadRef.kind === "direct") {
    const buffer = await fetchBinary(candidate.downloadRef.url);
    const extension = candidate.downloadRef.extension;
    const fileName = `${baseName}-${randomUUID().slice(0, 8)}${extension}`;
    const absolutePath = path.join(TEMP_ROOT, fileName);
    await fs.writeFile(absolutePath, buffer);
    return {
      absolutePath,
      originalName: fileName,
      extension,
      sizeBytes: buffer.byteLength
    };
  }

  // sketchfab-gltf: resolve signed URL → fetch → check magic bytes / extract zip.
  const { url, preferGlb } = await fetchSketchfabDownloadUrl(
    candidate.downloadRef.uid
  );
  const buffer = await fetchBinary(url);

  // A direct .glb starts with "glTF" magic. A zip starts with "PK".
  const magic = buffer.subarray(0, 4).toString("ascii");

  if (magic === "glTF") {
    const fileName = `${baseName}-${randomUUID().slice(0, 8)}.glb`;
    const absolutePath = path.join(TEMP_ROOT, fileName);
    await fs.writeFile(absolutePath, buffer);
    return {
      absolutePath,
      originalName: fileName,
      extension: ".glb",
      sizeBytes: buffer.byteLength
    };
  }

  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const extracted = extractGltfFromZip(buffer);
    const fileName = `${baseName}-${randomUUID().slice(0, 8)}${extracted.extension}`;
    const absolutePath = path.join(TEMP_ROOT, fileName);
    await fs.writeFile(absolutePath, extracted.data);
    return {
      absolutePath,
      originalName: fileName,
      extension: extracted.extension,
      sizeBytes: extracted.data.byteLength
    };
  }

  // Some Sketchfab endpoints return raw glTF JSON if preferGlb was false; treat as gltf text.
  if (!preferGlb && buffer.toString("utf8", 0, 1) === "{") {
    const fileName = `${baseName}-${randomUUID().slice(0, 8)}.gltf`;
    const absolutePath = path.join(TEMP_ROOT, fileName);
    await fs.writeFile(absolutePath, buffer);
    return {
      absolutePath,
      originalName: fileName,
      extension: ".gltf",
      sizeBytes: buffer.byteLength
    };
  }

  throw new Error(
    "Unexpected Sketchfab download payload (not glb, gltf JSON, or zip)."
  );
};
