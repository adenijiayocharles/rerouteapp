import { useCallback, useEffect, useRef, type Dispatch } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { api } from "../api";
import { errorMessage } from "../errorMessage";
import type { Action, UpdateStatus } from "../state/appReducer";

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Owns the auto-updater flow: periodic background checks, the
 * check/download/install handlers SettingsModal and the update toast call
 * into, and the in-flight `Update` handle those steps share (Tauri's
 * updater plugin hands back a stateful object from `check()` that
 * `download()`/`install()` are called on directly, so it has to survive
 * across those calls rather than round-tripping through the reducer). */
export function useUpdateChecker(dispatch: Dispatch<Action>, appVersion: string | null, autoCheckUpdates: boolean, updateStatus: UpdateStatus) {
  const pendingUpdateRef = useRef<Update | null>(null);
  const updateStatusRef = useRef<UpdateStatus>(updateStatus);
  useEffect(() => {
    updateStatusRef.current = updateStatus;
  }, [updateStatus]);

  const handleInstallUpdate = useCallback(async () => {
    const update = pendingUpdateRef.current;
    if (!update) return;
    try {
      await update.install();
      await api.relaunchApp();
    } catch (err) {
      dispatch({ type: "SET_UPDATE_STATUS", status: "error" });
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Update install failed", message: errorMessage(err) } });
    }
  }, [dispatch]);

  const handleDownloadUpdate = useCallback(async () => {
    const update = pendingUpdateRef.current;
    if (!update) return;
    dispatch({ type: "SET_UPDATE_STATUS", status: "downloading", progress: 0 });

    let contentLength = 0;
    let downloaded = 0;
    // Progress events fire once per network chunk (potentially hundreds of
    // times for a multi-MB installer); only dispatch when the rounded
    // percentage actually changes instead of on every chunk, since every
    // dispatch re-renders the whole app under the single top-level reducer.
    let lastDispatchedProgress: number | null = 0;
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const progress = contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : null;
          if (progress === lastDispatchedProgress) return;
          lastDispatchedProgress = progress;
          dispatch({ type: "SET_UPDATE_STATUS", status: "downloading", progress });
          dispatch({
            type: "SET_TOAST",
            toast: {
              type: "info",
              title: "Update available",
              message: progress !== null ? `Downloading re:route v${update.version}… ${progress}%` : `Downloading re:route v${update.version}…`,
            },
          });
        }
      });
      dispatch({ type: "SET_UPDATE_STATUS", status: "ready", version: update.version });
      dispatch({
        type: "SET_TOAST",
        toast: {
          type: "info",
          title: "Update ready",
          message: `Restart re:route to finish installing v${update.version}.`,
          updateAction: { label: "Restart", onClick: handleInstallUpdate },
        },
      });
    } catch (err) {
      dispatch({ type: "SET_UPDATE_STATUS", status: "error" });
      dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Update download failed", message: errorMessage(err) } });
    }
  }, [dispatch, handleInstallUpdate]);

  const handleCheckForUpdates = useCallback(
    async (manual: boolean) => {
      if (manual) dispatch({ type: "SET_UPDATE_STATUS", status: "checking" });
      try {
        const update = await api.checkForUpdate();
        if (!update) {
          if (manual) {
            dispatch({
              type: "SET_TOAST",
              toast: {
                type: "success",
                title: "You're up to date",
                message: appVersion ? `re:route v${appVersion} is the latest version.` : "You have the latest version.",
              },
            });
          }
          dispatch({ type: "SET_UPDATE_STATUS", status: "idle" });
          return;
        }
        pendingUpdateRef.current = update;
        dispatch({ type: "SET_UPDATE_STATUS", status: "available", version: update.version });
        dispatch({
          type: "SET_TOAST",
          toast: {
            type: "info",
            title: "Update available",
            message: `re:route v${update.version} is ready to download.`,
            updateAction: { label: "Download", onClick: handleDownloadUpdate },
          },
        });
      } catch (err) {
        if (manual) {
          dispatch({ type: "SET_UPDATE_STATUS", status: "idle" });
          dispatch({ type: "SET_TOAST", toast: { type: "error", title: "Couldn't check for updates", message: errorMessage(err) } });
        }
      }
    },
    [dispatch, appVersion, handleDownloadUpdate],
  );

  useEffect(() => {
    const interval = setInterval(() => {
      // Skip a tick that lands while the window is hidden/minimized rather
      // than firing an update check nobody can see the result of yet — the
      // next tick (or the next time the window becomes visible) covers it.
      if (autoCheckUpdates && updateStatusRef.current === "idle" && document.visibilityState === "visible") {
        handleCheckForUpdates(false);
      }
    }, UPDATE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [autoCheckUpdates, handleCheckForUpdates]);

  return { handleCheckForUpdates, handleDownloadUpdate, handleInstallUpdate };
}
