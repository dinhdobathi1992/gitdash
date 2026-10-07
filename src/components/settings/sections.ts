/**
 * Settings sub-navigation (design `Settings` artboard). Selected with
 * `/settings?section=<key>`; the top bar reads the label for its breadcrumb.
 */
export interface SettingsSection {
  key: string;
  label: string;
  group: "Organization" | "You";
  /** Only meaningful in organization mode. */
  orgOnly?: boolean;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { key: "general", label: "General", group: "Organization" },
  { key: "access", label: "Access by group", group: "Organization", orgOnly: true },
  { key: "members", label: "Members", group: "Organization", orgOnly: true },
  { key: "ai", label: "AI provider", group: "Organization", orgOnly: true },
  { key: "email", label: "Email and digests", group: "Organization" },
  { key: "working-habits", label: "Working habits", group: "Organization", orgOnly: true },
  { key: "team", label: "Team insights", group: "Organization", orgOnly: true },
  { key: "account-links", label: "Account links", group: "Organization", orgOnly: true },
  { key: "audit", label: "Audit log", group: "Organization", orgOnly: true },
  { key: "features", label: "My features", group: "You" },
  { key: "notifications", label: "Notifications", group: "You" },
  // Shown only when MCP is on (the grants API answers 404 otherwise).
  { key: "connected-apps", label: "Connected apps", group: "You" },
];

export function settingsSectionLabel(key: string | null): string | null {
  if (!key) return null;
  return SETTINGS_SECTIONS.find((s) => s.key === key)?.label ?? null;
}
