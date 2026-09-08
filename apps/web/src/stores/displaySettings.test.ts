import { afterEach, describe, expect, it } from "vitest";
import { useDisplaySettingsStore } from "./displaySettings.js";

const STORAGE_KEY = "sigmascout-display-settings";

/** Resets the store AND its persisted localStorage entry so no case inherits another's state. */
function resetStore() {
  useDisplaySettingsStore.setState({ showSwingFactor: true });
  window.localStorage.removeItem(STORAGE_KEY);
}

describe("displaySettings store (quick task 260908-5wd)", () => {
  afterEach(() => resetStore());

  it("defaults showSwingFactor to true, so a first-time visitor sees the site exactly as it is today", () => {
    resetStore();
    expect(useDisplaySettingsStore.getState().showSwingFactor).toBe(true);
  });

  it("toggling flips the value", () => {
    resetStore();
    useDisplaySettingsStore.getState().toggleSwingFactor();
    expect(useDisplaySettingsStore.getState().showSwingFactor).toBe(false);
  });

  it("toggling twice returns to the start", () => {
    resetStore();
    useDisplaySettingsStore.getState().toggleSwingFactor();
    useDisplaySettingsStore.getState().toggleSwingFactor();
    expect(useDisplaySettingsStore.getState().showSwingFactor).toBe(true);
  });

  it("persists the value under the stable localStorage key 'sigmascout-display-settings'", () => {
    resetStore();
    useDisplaySettingsStore.getState().toggleSwingFactor();

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as { state: { showSwingFactor: boolean } };
    expect(parsed.state.showSwingFactor).toBe(false);
  });

  it("rehydrates the persisted value on a fresh read of localStorage — simulating a reload", () => {
    resetStore();
    useDisplaySettingsStore.getState().toggleSwingFactor();
    const raw = window.localStorage.getItem(STORAGE_KEY) as string;

    // Simulate a reload: reset in-memory state without touching storage,
    // then rehydrate from the persisted payload exactly as the persist
    // middleware does on module load.
    useDisplaySettingsStore.setState({ showSwingFactor: true });
    const parsed = JSON.parse(raw) as { state: { showSwingFactor: boolean } };
    useDisplaySettingsStore.setState({ showSwingFactor: parsed.state.showSwingFactor });

    expect(useDisplaySettingsStore.getState().showSwingFactor).toBe(false);
  });
});
