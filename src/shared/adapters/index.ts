import type { SourceAdapter } from "../types";
import { krHiraAdapter } from "./krHira";

const adapters: SourceAdapter[] = [krHiraAdapter];

export function listSourceAdapters(): SourceAdapter[] {
  return adapters;
}

export function findAdapterById(id: string): SourceAdapter | null {
  return adapters.find((adapter) => adapter.id === id) ?? null;
}

export function findAdapterByUrl(url: string): SourceAdapter | null {
  return adapters.find((adapter) => adapter.match.some((re) => re.test(url))) ?? null;
}
