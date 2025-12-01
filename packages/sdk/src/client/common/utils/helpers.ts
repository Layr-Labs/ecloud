/**
 * General utility helpers
 */

/**
 * Ensure hex string has 0x prefix
 */
export function addHexPrefix(value: string): `0x${string}` {
  return (value.startsWith("0x") ? value : `0x${value}`) as `0x${string}`;
}

/**
 * Remove 0x prefix from hex string if present
 */
export function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}
