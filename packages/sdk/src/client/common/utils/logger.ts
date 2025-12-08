/**
 * Default logger
 */

import { Logger } from "../types";

export const defaultLogger: Logger = {
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  debug: (...args) => console.debug(...args),
};

export const getLogger: (verbose?: boolean) => Logger = (verbose?: boolean) => ({
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  debug: (...args) => verbose && console.debug(...args),
});
