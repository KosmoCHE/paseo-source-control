// How the panel asks the daemon half to run git.

import type { PluginRpcContract } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ZodType, input as ZodInput } from "zod";

/** Every query about one repository shares this prefix, so one invalidation reads it all again. */
export const key = (cwd: string, ...rest: unknown[]) => ["git-graph", cwd, ...rest];

/** A git command the user asked for. A failure is shown; either way the panel reads the repository again. */
export function useCommand<Input extends ZodType<{ cwd: string }>, Output extends ZodType>(contract: PluginRpcContract<Input, Output>, cwd: string) {
  const call = useRpc(contract);
  const toast = useToast();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<ZodInput<Input>, "cwd">) => call({ ...input, cwd } as ZodInput<Input>),
    onError: (error) => toast.error(error.message),
    onSettled: () => queries.invalidateQueries({ queryKey: key(cwd) }),
  });
}
