import type { PluginContext } from "@jarvis/core";
import { TaskManagerPiece } from "./task-manager.js";

export function createPieces(ctx: PluginContext) {
  return [new TaskManagerPiece(ctx)];
}
