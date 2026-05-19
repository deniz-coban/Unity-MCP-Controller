import type {
  OnlineModelCandidate,
  OnlineModelSource
} from "../types.js";
import { isPolyPizzaConfigured, searchPolyPizza } from "./polyPizza.js";
import { isSketchfabConfigured, searchSketchfab } from "./sketchfab.js";

export interface OnlineSearchResult {
  candidates: OnlineModelCandidate[];
  errors: Array<{ source: OnlineModelSource; message: string }>;
  attemptedSources: OnlineModelSource[];
  configuredSources: OnlineModelSource[];
}

const interleave = (
  groups: OnlineModelCandidate[][]
): OnlineModelCandidate[] => {
  const out: OnlineModelCandidate[] = [];
  let cursor = 0;
  while (groups.some((g) => cursor < g.length)) {
    for (const group of groups) {
      if (cursor < group.length) {
        out.push(group[cursor]);
      }
    }
    cursor += 1;
  }
  return out;
};

export const searchOnlineModels = async (
  query: string,
  sources: OnlineModelSource[],
  limit = 6
): Promise<OnlineSearchResult> => {
  const configuredSources: OnlineModelSource[] = [];
  if (isPolyPizzaConfigured()) configuredSources.push("poly_pizza");
  if (isSketchfabConfigured()) configuredSources.push("sketchfab");

  const attemptedSources = sources.filter((s) =>
    configuredSources.includes(s)
  );

  const errors: OnlineSearchResult["errors"] = [];
  const groups: OnlineModelCandidate[][] = [];

  const perSourceLimit = Math.max(2, Math.ceil(limit / attemptedSources.length || 1));

  const settled = await Promise.allSettled(
    attemptedSources.map(async (source) => {
      if (source === "poly_pizza") {
        return { source, results: await searchPolyPizza(query, perSourceLimit) };
      }
      return { source, results: await searchSketchfab(query, perSourceLimit) };
    })
  );

  for (let i = 0; i < settled.length; i += 1) {
    const result = settled[i];
    const source = attemptedSources[i];
    if (result.status === "fulfilled") {
      groups.push(result.value.results);
    } else {
      errors.push({
        source,
        message:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
      });
    }
  }

  const interleaved = interleave(groups).slice(0, limit);

  return {
    candidates: interleaved,
    errors,
    attemptedSources,
    configuredSources
  };
};
