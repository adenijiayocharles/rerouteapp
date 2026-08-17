import { useEffect, type Dispatch } from "react";
import type { Action } from "../state/appReducer";
import type { ToastState } from "../types";

/** Auto-dismisses every toast except "info" ones (used for in-progress
 * states like a download in flight, which should stick around until the
 * flow that showed them replaces or clears it). */
export function useAutoDismissToast(dispatch: Dispatch<Action>, toast: ToastState | null) {
  useEffect(() => {
    if (!toast) return;
    if (toast.type === "info") return;
    const timer = setTimeout(() => dispatch({ type: "SET_TOAST", toast: null }), 4200);
    return () => clearTimeout(timer);
  }, [dispatch, toast]);
}
