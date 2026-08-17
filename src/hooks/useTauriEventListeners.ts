import { useEffect, type Dispatch, type RefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Action } from "../state/appReducer";
import type { Entry, IpHealthResult } from "../types";

const HOSTS_CHANGED_EVENT = "hosts-file-changed-externally";
const ENTRIES_CHANGED_EVENT = "entries-changed";
const IP_HEALTH_CHECKED_EVENT = "ip-health-checked";
const MENU_ACTION_EVENT = "menu-action";

/** Subscribes to every event the Rust backend emits outside a direct
 * `invoke()` response: an externally-edited hosts file, entries changed
 * from the menu-bar tray, a post-switch reachability ping, and the native
 * File menu's mirrored actions. */
export function useTauriEventListeners(
  dispatch: Dispatch<Action>,
  refreshEntries: () => Promise<void>,
  refreshRawFile: () => Promise<void>,
  entriesRef: RefObject<Entry[]>,
  handleFlushDns: () => Promise<void>,
) {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen(HOSTS_CHANGED_EVENT, () => dispatch({ type: "EXTERNAL_CHANGE_DETECTED" })).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [dispatch]);

  useEffect(() => {
    // Entries can change from the menu bar tray (switching an entry's
    // active IP) without any invoke() call originating from this window,
    // so pick those changes up here instead of relying on each caller to
    // refresh.
    let unlisten: (() => void) | undefined;
    listen(ENTRIES_CHANGED_EVENT, () => {
      refreshEntries().catch(() => {});
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [refreshEntries]);

  useEffect(() => {
    // Fired by the backend a moment after a successful IP switch, once its
    // background ping resolves (see `switch_active_ip`/`ping.rs`) — never
    // blocks the switch itself, just warns after the fact if the newly
    // active IP didn't respond.
    let unlisten: (() => void) | undefined;
    listen<IpHealthResult>(IP_HEALTH_CHECKED_EVENT, (event) => {
      const { entryId, ipId, reachable } = event.payload;
      if (reachable) return;
      dispatch({ type: "SET_IP_UNREACHABLE", entryId, ipId });
      const entry = entriesRef.current.find((e) => e.id === entryId);
      if (!entry || entry.activeIpId !== ipId) return; // switched again before this landed
      const ip = entry.ips.find((i) => i.id === ipId);
      dispatch({
        type: "SET_TOAST",
        toast: {
          type: "warning",
          title: "IP unreachable",
          message: `${entry.hostname} now points to ${ip?.ip ?? ipId}, but it didn't respond to a ping.`,
        },
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [dispatch, entriesRef]);

  useEffect(() => {
    // The native File menu mirrors a handful of in-app actions so they're
    // reachable without the window already being focused on the right view.
    let unlisten: (() => void) | undefined;
    listen<string>(MENU_ACTION_EVENT, (event) => {
      switch (event.payload) {
        case "add-entry":
          dispatch({ type: "OPEN_ADD_PANEL" });
          break;
        case "flush-dns":
          handleFlushDns();
          break;
        case "open-raw-file":
          dispatch({ type: "GO_RAW" });
          refreshRawFile().catch(() => {});
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [dispatch, handleFlushDns, refreshRawFile]);
}
