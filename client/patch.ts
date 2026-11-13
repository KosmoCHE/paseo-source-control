// Tells the lines of a unified diff apart, so each can be coloured.

export interface Line {
  text: string;
  kind: "meta" | "hunk" | "add" | "remove" | "plain";
}

/** Everything before a file's first hunk is its header. */
export function parsePatch(patch: string): Line[] {
  if (!patch) return [];
  let header = true;
  return patch
    .replace(/\n$/, "")
    .split("\n")
    .map((text) => {
      if (text.startsWith("diff ")) header = true;
      else if (text.startsWith("@@")) {
        header = false;
        return { text, kind: "hunk" };
      }
      if (header || text.startsWith("\\")) return { text, kind: "meta" };
      return { text, kind: text[0] === "+" ? "add" : text[0] === "-" ? "remove" : "plain" };
    });
}
