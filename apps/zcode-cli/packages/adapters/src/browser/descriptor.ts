import type { BrowserBackendDescriptor } from "@zcode/contracts";

export interface ManagedCdpDescriptorOverrides {
  name?: string;
  launchMode?: string;
  headless?: string;
  provider?: string;
}

export function createManagedCdpDescriptor(
  browserId: string,
  generation: number,
  overrides: ManagedCdpDescriptorOverrides = {},
): BrowserBackendDescriptor {
  return {
    id: browserId,
    generation,
    type: "cdp",
    name: overrides.name ?? "ZCode Headless Chromium",
    capabilities: {
      browser: [],
      tab: [],
    },
    apiSupportOverrides: {
      "BrowserUser.openTabs": false,
      "BrowserUser.history": false,
      "PlaywrightAPI.waitForEvent": false,
      "PlaywrightDownload.path": false,
      "PlaywrightFileChooser.setFiles": false,
      "PlaywrightLocator.downloadMedia": false,
      "PlaywrightLocator.evaluate": false,
      "CUAAPI.downloadMedia": false,
      "DomCUAAPI.downloadMedia": false,
    },
    metadata: {
      provider: overrides.provider ?? "zcode-cli",
      launchMode: overrides.launchMode ?? "managed",
      headless: overrides.headless ?? "true",
    },
  };
}
