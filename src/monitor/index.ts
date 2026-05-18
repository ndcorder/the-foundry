export {
  type MonitorWarning,
  type MonitorConfig,
  type CorrectiveAction,
  type MonitorSeverity,
  DEFAULT_MONITOR_CONFIG,
} from "./types.js";

export {
  detectSlop,
  detectRepetition,
  detectManifestoDrift,
  detectDomainCollapse,
  runAllDetectors,
  type IterationEntry,
} from "./detectors.js";
