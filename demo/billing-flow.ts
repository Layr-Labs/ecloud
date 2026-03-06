#!/usr/bin/env npx tsx
/**
 * ecloud billing — proposed payment flow demo
 *
 * npx tsx /Users/matt/Eigen/EigenCompute/ecloud/demo/billing-flow.ts
 *
 * Shows what the four billing commands look like with USDC credit purchasing.
 * No API keys needed. Just prints the terminal output.
 */

const R = "\x1b[0m";
const B = "\x1b[1m";
const D = "\x1b[2m";
const G = "\x1b[32m";
const Y = "\x1b[33m";
const C = "\x1b[36m";
const GR = "\x1b[90m";

const WALLET = "0x7a3B…e91F";
const CONTRACT = "0x4f2C…8aD3";

console.clear();
console.log();
console.log(`${B}  ecloud billing — Proposed Payment Flow${R}`);
console.log(`${D}  Four commands. Credit card + USDC credit purchasing.${R}`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

console.log(`\n${GR}  ${"━".repeat(65)}${R}`);
console.log(`${B}  1. ecloud billing subscribe${R}  ${D}(modified — adds payment choice)${R}`);
console.log(`${GR}  ${"━".repeat(65)}${R}`);
console.log();
console.log(`  ${GR}$${R} ${B}ecloud billing subscribe${R}`);
console.log();
console.log(`  ${B}? How would you like to pay for EigenCompute?${R}  ${D}(Use arrow keys)${R}`);
console.log(`  ${C}❯ Credit card${R}                  ${D}— Pay via Stripe checkout (opens browser)${R}`);
console.log(`    Purchase credits with USDC   ${D}— Pay on-chain — no credit card needed${R}`);
console.log();
console.log(`  ${D}If user picks credit card → existing Stripe flow (unchanged)${R}`);
console.log(`  ${D}If user picks USDC → runs \`ecloud billing top-up\` (see below)${R}`);
console.log();
console.log(`  ${D}During Stripe checkout, shows:${R}`);
console.log(`  ${GR}Prefer to pay with USDC? Run: ecloud billing top-up${R}`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

console.log(`\n${GR}  ${"━".repeat(65)}${R}`);
console.log(`${B}  2. ecloud billing top-up${R}  ${G}(new command)${R}`);
console.log(`${GR}  ${"━".repeat(65)}${R}`);
console.log();
console.log(`  ${GR}$${R} ${B}ecloud billing top-up${R}`);
console.log();
console.log(`  ${B}Purchase EigenCompute credits${R}`);
console.log(`  ${GR}${"─".repeat(45)}${R}`);
console.log();
console.log(`    ${B}Your wallet:${R}  ${WALLET}`);
console.log(`    ${B}Credits:${R}      ${C}$12.40${R}`);
console.log();
console.log(`    ${B}Purchase with USDC${R}`);
console.log(`    ${B}Contract:${R}     ${C}${CONTRACT}${R}`);
console.log(`    ${B}Chain:${R}        Base (Chain ID: 8453)`);
console.log(`    ${B}Token:${R}        USDC`);
console.log();
console.log(`    ${B}How it works:${R}`);
console.log(`    1. Send USDC to the contract on Base`);
console.log(`    2. Credits appear after on-chain confirmation`);
console.log(`    3. First purchase gets up to $25 matched`);
console.log();
console.log(`    ${Y}Note:${R} Credits are non-refundable.`);
console.log(`    Send only USDC on Base — other tokens will not be credited.`);
console.log();
console.log(`    ${GR}Check your balance:${R} ecloud billing status`);
console.log();
console.log(`  ${D}Future: CLI will execute the tx directly (wallet already loaded).${R}`);
console.log(`  ${D}For now: shows contract address for manual send.${R}`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

console.log(`\n${GR}  ${"━".repeat(65)}${R}`);
console.log(`${B}  3. ecloud billing status${R}  ${D}(existing — adds top-up hint)${R}`);
console.log(`${GR}  ${"━".repeat(65)}${R}`);
console.log();
console.log(`  ${GR}$${R} ${B}ecloud billing status${R}`);
console.log();
console.log(`  ${B}Subscription Status:${R}`);
console.log(`    Wallet: ${WALLET}`);
console.log(`    Status: ${G}✓ Active${R}`);
console.log(`    Product: compute`);
console.log(`    Current Period: 2/6/2026 - 3/6/2026`);
console.log();
console.log(`    ${B}Remaining Credits:${R} ${C}$3.20${R} (expires 5/6/2026)`);
console.log();
console.log(`  ${B}Need more credits?${R}`);
console.log(`    Run ${C}ecloud billing top-up${R} to purchase credits.`);
console.log();
console.log(`  ${D}↑ This hint only appears when credits < $10 or subscription inactive.${R}`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

console.log(`\n${GR}  ${"━".repeat(65)}${R}`);
console.log(`${B}  4. ecloud billing cancel${R}  ${D}(unchanged)${R}`);
console.log(`${GR}  ${"━".repeat(65)}${R}`);
console.log();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

console.log(`${GR}  ${"━".repeat(65)}${R}`);
console.log(`${B}  Summary of changes${R}`);
console.log(`${GR}  ${"━".repeat(65)}${R}`);
console.log();
console.log(`  ${G}NEW${R}       ecloud billing top-up     Purchase credits (USDC now, CC later)`);
console.log(`  ${Y}MODIFIED${R}  ecloud billing subscribe  Adds CC vs USDC selection prompt`);
console.log(`  ${Y}MODIFIED${R}  ecloud billing status     Adds "Need more credits?" hint`);
console.log(`  ${D}—${R}         ecloud billing cancel     Unchanged`);
console.log();
console.log(`  ${D}Billing API changes: none (USDC backend is PR #22, Sean's branch).${R}`);
console.log(`  ${D}These are CLI-only changes that surface the USDC path to users.${R}`);
console.log();
