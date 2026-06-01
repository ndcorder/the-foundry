export {
  type MonitorWarning,
  type MonitorConfig,
  type CorrectiveAction,
  type MonitorSeverity,
  type MonitorWarningSnapshot,
  type MonitorWarningStatus,
  type FurnaceHealthLevel,
  type FurnaceHealthStatus,
  DEFAULT_MONITOR_CONFIG,
} from "./types.js";

export {
  detectSlop,
  detectRepetition,
  detectManifestoDrift,
  detectDomainCollapse,
  detectComplexityYield,
  detectLogHealth,
  runAllDetectors,
  type IterationEntry,
} from "./detectors.js";

export {
  summarizeMonitorWarnings,
  summarizeFurnaceHealth,
} from "./status.js";
