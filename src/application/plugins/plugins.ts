import type { PluginViewInfo } from "../../domain/plugins/types";
import * as backend from "../../infrastructure/backend";

/** The plugin's view, read from its server (started when it is not running) and served: where the frame loads it from. */
export const loadPluginView = (id: string, uri?: string): Promise<PluginViewInfo> => backend.pluginView(id, uri);
