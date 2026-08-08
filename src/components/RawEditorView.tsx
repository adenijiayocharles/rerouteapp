import { useEffect, useRef } from "react";
import { Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { syntaxHighlighting } from "@codemirror/language";
import type { ColorTokens } from "../theme";
import type { LintDiagnostic } from "../types";
import { api } from "../api";
import { hostsLanguage, hostsHighlightStyle } from "./hostsLanguage";

interface RawEditorViewProps {
  c: ColorTokens;
  content: string;
  baseline: string;
  disabled: boolean;
  onChange: (content: string) => void;
  onRequestSave: (content: string) => void;
}

function buildEditorTheme(c: ColorTokens) {
  return EditorView.theme({
    "&": { color: c.text, backgroundColor: c.bg, height: "100%", fontSize: "12.5px" },
    ".cm-content": { fontFamily: "'JetBrains Mono',monospace", caretColor: c.text },
    ".cm-gutters": { backgroundColor: c.bg, color: c.textFaint, border: "none" },
    ".cm-activeLine": { backgroundColor: c.rowHover },
    ".cm-activeLineGutter": { backgroundColor: c.rowHover },
  });
}

export function RawEditorView({ c, content, baseline, disabled, onChange, onRequestSave }: RawEditorViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastEmitted = useRef(content);
  const onChangeRef = useRef(onChange);
  const onRequestSaveRef = useRef(onRequestSave);
  const themeCompartment = useRef(new Compartment());
  const highlightCompartment = useRef(new Compartment());

  onChangeRef.current = onChange;
  onRequestSaveRef.current = onRequestSave;

  useEffect(() => {
    const view = new EditorView({
      doc: content,
      parent: containerRef.current!,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: (v) => {
              onRequestSaveRef.current(v.state.doc.toString());
              return true;
            },
          },
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        hostsLanguage,
        themeCompartment.current.of(buildEditorTheme(c)),
        highlightCompartment.current.of(syntaxHighlighting(hostsHighlightStyle(c))),
        lintGutter(),
        linter(
          async (v) => {
            const diagnostics: LintDiagnostic[] = await api.lintHostsContent(v.state.doc.toString());
            return diagnostics.map((d): Diagnostic => {
              const clampedLine = Math.min(Math.max(d.line, 1), v.state.doc.lines);
              const line = v.state.doc.line(clampedLine);
              return { from: line.from, to: line.to, severity: d.severity, message: d.message };
            });
          },
          { delay: 500 },
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString();
            lastEmitted.current = text;
            onChangeRef.current(text);
          }
        }),
      ],
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Intentionally runs once: theme/highlight updates go through the
    // compartments below rather than tearing down and recreating the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        themeCompartment.current.reconfigure(buildEditorTheme(c)),
        highlightCompartment.current.reconfigure(syntaxHighlighting(hostsHighlightStyle(c))),
      ],
    });
  }, [c]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && content !== lastEmitted.current && content !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
      lastEmitted.current = content;
    }
  }, [content]);

  const dirty = content !== baseline;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: c.bg }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          borderBottom: `1px solid ${c.border}`,
          flex: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: c.textMuted }}>
          {dirty && <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.accent, flex: "none" }} />}
          {dirty ? "Unsaved changes" : "/etc/hosts"}
        </div>
        <button
          onClick={() => onRequestSave(content)}
          disabled={!dirty || disabled}
          style={{
            height: 30,
            padding: "0 14px",
            borderRadius: 7,
            border: "none",
            background: c.accent,
            color: "#fff",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: !dirty || disabled ? "not-allowed" : "pointer",
            opacity: !dirty || disabled ? 0.5 : 1,
          }}
        >
          Save
        </button>
      </div>
      <div ref={containerRef} className="hm-scroll" style={{ flex: 1, overflow: "auto" }} />
    </div>
  );
}
