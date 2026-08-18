import { useCallback, useReducer } from "react";
import "./App.css";
import { createInitialState, reducer, type State } from "./state/appReducer";
import type { Entry } from "./types";
import { loadStoredThemePreference, systemPrefersDarkNow, useThemeController } from "./hooks/useThemeController";
import { useDataRefresh } from "./hooks/useDataRefresh";
import { useUpdateChecker } from "./hooks/useUpdateChecker";
import { useSettingsSync } from "./hooks/useSettingsSync";
import { useAppBootstrap } from "./hooks/useAppBootstrap";
import { useTauriEventListeners } from "./hooks/useTauriEventListeners";
import { useAutoDismissToast } from "./hooks/useAutoDismissToast";
import { useEntryWriteFlow } from "./hooks/useEntryWriteFlow";
import { useDerivedListData } from "./hooks/useDerivedListData";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { ListView } from "./components/ListView";
import { HistoryView } from "./components/HistoryView";
import { RawEditorView } from "./components/RawEditorView";
import { DraftPanel } from "./components/DraftPanel";
import { DiffModal } from "./components/DiffModal";
import { Toast } from "./components/Toast";
import { ReloadBanner } from "./components/ReloadBanner";
import { SettingsModal } from "./components/SettingsModal";
import { SwitchIpModal } from "./components/SwitchIpModal";
import { DoctorModal } from "./components/DoctorModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { api } from "./api";

const initialState: State = createInitialState({
  themePreference: loadStoredThemePreference(),
  systemPrefersDark: systemPrefersDarkNow(),
});

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const { theme, c } = useThemeController(state.themePreference, state.systemPrefersDark, dispatch);

  const refresh = useDataRefresh(dispatch, state.entries);

  const updateChecker = useUpdateChecker(dispatch, state.appVersion, state.autoCheckUpdates, state.updateStatus);

  const settingsSync = useSettingsSync(dispatch, state.helperActive, state.unmanagedListCollapsed, refresh.refreshHelperStatus);

  useAppBootstrap(dispatch, refresh, updateChecker.handleCheckForUpdates);

  const entryFlow = useEntryWriteFlow(dispatch, state, refresh);

  useTauriEventListeners(dispatch, refresh.refreshEntries, refresh.refreshRawFile, refresh.entriesRef, entryFlow.handleFlushDns);

  useAutoDismissToast(dispatch, state.toast);

  const { filteredEntries, groupEntries, filteredUnmanagedEntries, conflictsByEntry, groups } = useDerivedListData(state);

  // Stable references so ListView's memoized EntryRow/UnmanagedRow children
  // don't re-render (and re-subscribe their effects) on every unrelated
  // App re-render — see EntryRow.tsx.
  const handleSearchChange = useCallback((value: string) => dispatch({ type: "SET_SEARCH", value }), []);
  const handleToggleHostnameSort = useCallback(() => dispatch({ type: "TOGGLE_HOSTNAME_SORT" }), []);
  const handleOpenAddPanel = useCallback(() => dispatch({ type: "OPEN_ADD_PANEL" }), []);
  const handleClearGroupFilter = useCallback(() => dispatch({ type: "CLEAR_GROUP_FILTER" }), []);
  const handleOpenSwitchIpModal = useCallback(() => dispatch({ type: "OPEN_SWITCH_IP_MODAL" }), []);
  const handleToggleIpMenu = useCallback((id: string) => dispatch({ type: "TOGGLE_IP_MENU", id }), []);
  const handleOpenEditPanel = useCallback((entry: Entry) => dispatch({ type: "OPEN_EDIT_PANEL", entry }), []);
  const handleDuplicateEntry = useCallback((entry: Entry) => dispatch({ type: "DUPLICATE_ENTRY", entry }), []);
  const handleDeleteFromRow = useCallback((entryId: string) => entryFlow.handleRequestDelete(entryId), [entryFlow.handleRequestDelete]);

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: c.bg,
        color: c.text,
        fontFamily: "'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        fontSize: 14,
        transition: "background .25s ease",
        position: "relative",
        overflow: "hidden",
        // @ts-expect-error custom property for scrollbar thumb color
        "--hm-scroll-thumb": c.scrollThumb,
      }}
    >
      <TitleBar
        c={c}
        version={state.appVersion}
        onFlushDns={entryFlow.handleFlushDns}
        onOpenSettings={() => dispatch({ type: "OPEN_SETTINGS" })}
        onOpenDoctor={() => dispatch({ type: "OPEN_DOCTOR" })}
      />

      {state.externalChangeDetected && (
        <ReloadBanner c={c} onReload={entryFlow.handleReload} onDismiss={() => dispatch({ type: "DISMISS_EXTERNAL_CHANGE" })} />
      )}

      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        <Sidebar
          c={c}
          view={state.view}
          onGoList={() => dispatch({ type: "GO_LIST" })}
          onGoHistory={() => dispatch({ type: "GO_HISTORY" })}
          onGoRaw={() => {
            dispatch({ type: "GO_RAW" });
            refresh.refreshRawFile().catch(() => {});
          }}
          entryCount={state.entries.length}
          groups={groups}
          groupFilter={state.groupFilter}
          onSelectGroup={(g) => dispatch({ type: "SELECT_GROUP", group: g })}
          onRenameGroup={entryFlow.handleRenameGroup}
        />

        {state.view === "list" ? (
          <ListView
            c={c}
            entries={filteredEntries}
            totalEntryCount={state.entries.length}
            conflictsByEntry={conflictsByEntry}
            unreachableIps={state.unreachableIps}
            unmanagedEntries={state.groupFilter ? [] : filteredUnmanagedEntries}
            search={state.search}
            onSearchChange={handleSearchChange}
            hostnameSort={state.hostnameSort}
            onToggleHostnameSort={handleToggleHostnameSort}
            onAddClick={handleOpenAddPanel}
            groupFilter={state.groupFilter}
            onClearGroupFilter={handleClearGroupFilter}
            onOpenSwitchIpModal={handleOpenSwitchIpModal}
            openIpMenuId={state.openIpMenuId}
            flushingId={state.flushingId}
            disabled={state.externalChangeDetected}
            onToggleDropdown={handleToggleIpMenu}
            onToggleEnabled={entryFlow.handleToggleEnabled}
            onEdit={handleOpenEditPanel}
            onDuplicate={handleDuplicateEntry}
            onDelete={handleDeleteFromRow}
            onSwitchIp={entryFlow.handleSwitchIp}
            onAdopt={entryFlow.handleRequestAdopt}
            unmanagedCollapsed={state.unmanagedListCollapsed}
            onToggleUnmanagedCollapsed={settingsSync.handleToggleUnmanagedCollapsed}
          />
        ) : state.view === "history" ? (
          <HistoryView c={c} history={state.history} onViewDiff={entryFlow.handleViewHistoryDiff} onRestore={entryFlow.handleRequestRestore} />
        ) : (
          <RawEditorView
            c={c}
            content={state.rawDraftContent ?? ""}
            baseline={state.rawFileContent ?? ""}
            disabled={state.externalChangeDetected}
            onChange={(content) => dispatch({ type: "SET_RAW_DRAFT_CONTENT", content })}
            onRequestSave={entryFlow.handleRequestRawSave}
          />
        )}
      </div>

      {state.editingDraft && (
        <DraftPanel
          c={c}
          theme={theme}
          draft={state.editingDraft}
          saving={state.savingDraft}
          onClose={() => dispatch({ type: "CLOSE_DRAFT" })}
          onFieldChange={(field, value) => dispatch({ type: "UPDATE_DRAFT_FIELD", field, value })}
          onIpFieldChange={(uid, field, value) => dispatch({ type: "UPDATE_DRAFT_IP", uid, field, value })}
          onAddIpRow={() => dispatch({ type: "ADD_DRAFT_IP_ROW" })}
          onRemoveIpRow={(uid) => dispatch({ type: "REMOVE_DRAFT_IP_ROW", uid })}
          onSetActive={(uid) => dispatch({ type: "SET_DRAFT_ACTIVE", uid })}
          onToggleEnabled={() => dispatch({ type: "TOGGLE_DRAFT_ENABLED" })}
          onSave={entryFlow.handleRequestSave}
          onDelete={() => {
            if (state.editingDraft?.id) entryFlow.handleRequestDelete(state.editingDraft.id);
          }}
        />
      )}

      {state.diff && (
        <DiffModal
          key={state.diff.title + state.diff.subtitle}
          c={c}
          diff={state.diff}
          confirming={state.confirmingDiff}
          onCancel={() => dispatch({ type: "CLOSE_DIFF" })}
          onConfirm={entryFlow.handleConfirmDiff}
        />
      )}

      {state.switchIpOpen && state.groupFilter && (
        <SwitchIpModal
          c={c}
          groupName={state.groupFilter}
          entries={groupEntries}
          onCancel={() => dispatch({ type: "CLOSE_SWITCH_IP_MODAL" })}
          onSwitchIp={entryFlow.handleSwitchGroupIp}
        />
      )}

      {state.settingsOpen && (
        <SettingsModal
          c={c}
          helperEnabled={state.helperEnabled}
          helperActive={state.helperActive}
          helperSupported={state.helperSupported}
          launchAtLogin={state.launchAtLogin}
          autoFlushDns={state.autoFlushDns}
          confirmBeforeSave={state.confirmBeforeSave}
          propagateGroupIps={state.propagateGroupIps}
          themePreference={state.themePreference}
          historyRetention={state.historyRetention}
          appVersion={state.appVersion}
          autoCheckUpdates={state.autoCheckUpdates}
          checkingForUpdates={state.updateStatus === "checking"}
          onClose={() => dispatch({ type: "CLOSE_SETTINGS" })}
          onSetThemePreference={(preference) => dispatch({ type: "SET_THEME_PREFERENCE", preference })}
          onSetHelperEnabled={settingsSync.handleSetHelperEnabled}
          onSetLaunchAtLogin={settingsSync.handleSetLaunchAtLogin}
          onSetAutoFlushDns={settingsSync.handleSetAutoFlushDns}
          onSetConfirmBeforeSave={settingsSync.handleSetConfirmBeforeSave}
          onSetPropagateGroupIps={settingsSync.handleSetPropagateGroupIps}
          onSetHistoryRetention={settingsSync.handleSetHistoryRetention}
          onSetAutoCheckUpdates={settingsSync.handleSetAutoCheckUpdates}
          onCheckForUpdatesNow={() => updateChecker.handleCheckForUpdates(true)}
        />
      )}

      {state.doctorOpen && (
        <DoctorModal c={c} onClose={() => dispatch({ type: "CLOSE_DOCTOR" })} runDiagnostics={api.runDiagnostics} />
      )}

      {state.toast && (
        <Toast
          c={c}
          toast={state.toast}
          onDismiss={() => dispatch({ type: "SET_TOAST", toast: null })}
          onRetryFlush={entryFlow.handleFlushDns}
        />
      )}

      {state.showOnboarding && (
        <OnboardingModal c={c} entries={state.onboardingEntries} onAdopt={entryFlow.handleAdoptSelected} onSkip={entryFlow.handleSkipOnboarding} />
      )}
    </div>
  );
}
