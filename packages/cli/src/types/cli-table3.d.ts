declare module "cli-table3" {
  export type TableAlignment = "left" | "center" | "right";

  export interface TableConstructorOptions {
    head?: Array<string>;
    colWidths?: Array<number>;
    colAligns?: Array<TableAlignment>;
    wordWrap?: boolean;
    style?: Record<string, unknown>;
    chars?: Record<string, string>;
  }

  // Minimal typing surface we rely on in the CLI.
  export default class Table {
    constructor(options?: TableConstructorOptions);
    push(...rows: Array<unknown>): number;
    toString(): string;
  }
}
