import { StreamLanguage } from "@codemirror/language";
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { StreamParser } from "@codemirror/language";
import type { ColorTokens } from "../theme";

interface HostsLineState {
  seenIpOnLine: boolean;
}

const hostsStreamParser: StreamParser<HostsLineState> = {
  startState: () => ({ seenIpOnLine: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.seenIpOnLine = false;
      const trimmed = stream.string.trim();
      if (trimmed === "# hosts-manager:start" || trimmed === "# hosts-manager:end") {
        stream.skipToEnd();
        return "keyword";
      }
    }
    if (stream.eatSpace()) return null;
    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (!state.seenIpOnLine) {
      stream.eatWhile(/\S/);
      state.seenIpOnLine = true;
      return "number";
    }
    stream.eatWhile(/\S/);
    return "string";
  },
};

export const hostsLanguage = StreamLanguage.define(hostsStreamParser);

/// Maps the language's legacy token names (keyword/comment/number/string)
/// to colors pulled from the active theme's ColorTokens, so highlighting
/// matches the app's light/dark/true-dark palette automatically.
export function hostsHighlightStyle(c: ColorTokens): HighlightStyle {
  return HighlightStyle.define([
    { tag: tags.keyword, color: c.accent, fontWeight: "700" },
    { tag: tags.comment, color: c.textFaint, fontStyle: "italic" },
    { tag: tags.number, color: c.accent },
    { tag: tags.string, color: c.text },
  ]);
}
