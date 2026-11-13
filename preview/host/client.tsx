// Stands in for @getpaseo/plugin/client in the browser preview.

import { useState } from "react";
import type { ZodType } from "zod";

interface Contract {
  name: string;
  output: ZodType;
}

/** RPCs go to serve.mjs, which runs the plugin's own handlers. */
export function useRpc(contract: Contract) {
  return async (input: unknown) => {
    const response = await fetch("/rpc/" + contract.name, { method: "POST", body: JSON.stringify(input) });
    const answer = await response.json();
    if (!response.ok) throw new Error(answer.error);
    return contract.output.parse(answer);
  };
}

/** The one workspace of the preview is the repository named in the address. */
export function useWorkspace<Selection>(_id: string, selector: (workspace: { directory: string }) => Selection) {
  const directory = new URLSearchParams(location.search).get("cwd");
  if (!directory) throw new Error("Add ?cwd=/path/to/a/repository to the address");
  return selector({ directory });
}

export function useTabState<State>(_tab: unknown, _schema: unknown, initial: State) {
  return useState(initial);
}
