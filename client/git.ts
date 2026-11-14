// How the panel asks the daemon half to run git.

import type { PluginRpcContract } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ZodType, input as ZodInput } from "zod";
import { statusRpc, syncRpc } from "../shared/git";

/** Every query of the plugin shares this prefix, so one invalidation reads everything again. */
export const key = (...parts: unknown[]) => ["source-control", ...parts];

/** A repository's working tree, read again every few seconds. Everything showing one repository shares the reading. */
export function useStatus(cwd: string) {
  const read = useRpc(statusRpc);
  return useQuery({ queryKey: key("status", cwd), queryFn: () => read({ cwd }), refetchInterval: 3000 });
}

/** A git command the user asked for. A failure is shown; either way the panel reads the repository again. */
export function useCommand<Input extends ZodType<{ cwd: string }>, Output extends ZodType>(contract: PluginRpcContract<Input, Output>, cwd: string) {
  const call = useRpc(contract);
  const toast = useToast();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ZodInput<Input>, "cwd">) => call({ ...input, cwd } as ZodInput<Input>),
    onError: (error) => toast.error(error.message),
    onSettled: () => queries.invalidateQueries({ queryKey: key() }),
  });
}

const AUTO_FETCH = 180_000; // VS Code's git.autofetchPeriod, three minutes

/**
 * Fetches the repository as VS Code does with `git.autofetch` on: now, then every three minutes, waiting while the window
 * is in the background. A failure is shown once, however often it repeats. Draws nothing.
 */
export function AutoFetch({ cwd }: { cwd: string }) {
  const fetch = useRpc(syncRpc);
  const toast = useToast();
  // The query client already repeats a query and pauses it in the background. The key is outside the plugin's prefix,
  // so the reading again after every command does not fetch too; what a fetch brings shows with the next status.
  const auto = useQuery({
    queryKey: ["source-control-auto-fetch", cwd],
    queryFn: () => fetch({ cwd, action: "fetch" }),
    staleTime: AUTO_FETCH,
    refetchInterval: AUTO_FETCH,
    retry: false,
  });
  const failed = auto.error?.message ?? null;
  useEffect(() => {
    if (failed) toast.error(`Auto fetch failed: ${failed}`);
  }, [failed]); // not on `toast`: the same failure again is not shown again
  return null;
}
