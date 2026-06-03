// Tests for caller.ts utility functions.
// getScheduledRelease was removed along with AppController.scheduleUpgrade /
// executeUpgrade / cancelUpgrade — all timelocked ops now go through the
// generic Timelock.schedule → execute flow (scheduleTimelockOp / executeTimelockOp).
